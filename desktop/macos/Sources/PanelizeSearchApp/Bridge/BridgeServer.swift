import Darwin
import Foundation
import PanelizeSearchCore
import Security

enum BridgeSendUpdate {
    case accepted
    case progress(SendProgress)
    case succeeded(SendOutcome)
    case failed(String)
}

enum NewChatUpdate {
    case succeeded(NewChatOutcome)
    case failed(String)
}

final class BridgeServer {
    private let socket = UnixSocketServer()
    private let historyStore: PromptHistoryStore
    private let stateQueue = DispatchQueue(label: "com.panelize.search.bridge-state")
    private var pending: [String: (BridgeSendUpdate) -> Void] = [:]
    private var pendingNewChats: [String: (NewChatUpdate) -> Void] = [:]
    private var snapshotAssembler = HistorySnapshotAssembler()
    private var extensionVersion = ""
    private var extensionProtocolVersion = BridgeProtocol.version
    private var extensionCapabilities: Set<String> = []
    private var hostVersion = 0
    private var hostCapabilities: Set<String> = []
    private var browserBundleIdentifier: String?
    private var hostConnected = false
    private var extensionConnected = false
    private var didSendClientHello = false
    private var lastHistoryRequestAt = Date.distantPast

    var onStatusChange: ((BridgeStatusSnapshot) -> Void)?
    var onExtensionConnected: (() -> Void)?
    var onHistoryChanged: (([PromptHistoryRecord]) -> Void)?

    init(historyStore: PromptHistoryStore = PromptHistoryStore()) {
        self.historyStore = historyStore
    }

    var isReady: Bool {
        stateQueue.sync { hostConnected && extensionConnected }
    }

    var isExtensionConnected: Bool {
        stateQueue.sync { extensionConnected }
    }

    var capabilities: Set<String> {
        stateQueue.sync { extensionCapabilities }
    }

    /// Features need both peers to support them: the extension to handle the
    /// command and the native host to forward it. A legacy host advertises
    /// nothing, so its messages would otherwise be dropped silently.
    var supportsHistorySync: Bool {
        stateQueue.sync {
            extensionConnected
                && extensionCapabilities.contains("historySync")
                && hostCapabilities.contains("historySync")
        }
    }

    var supportsNewChat: Bool {
        stateQueue.sync {
            extensionConnected
                && extensionCapabilities.contains("newChat")
                && hostCapabilities.contains("newChat")
        }
    }

    /// Whether the running native host can relay new-chat commands. Lets the
    /// composer tell a stale host apart from an outdated extension.
    var hostSupportsNewChat: Bool {
        stateQueue.sync { hostCapabilities.contains("newChat") }
    }

    /// The browser app that hosts the native bridge, as reported by the host's
    /// handshake. Nil until a host connects.
    var connectedBrowserBundleIdentifier: String? {
        stateQueue.sync { browserBundleIdentifier }
    }

    func start() throws {
        socket.onPeerConnected = { [weak self] browserBundleIdentifier in
            guard let self else { return }
            self.stateQueue.async {
                self.hostConnected = true
                self.browserBundleIdentifier = browserBundleIdentifier
                self.emitStatus()
            }
        }
        socket.onPeerDisconnected = { [weak self] in
            guard let self else { return }
            let pending: [(BridgeSendUpdate) -> Void] = self.stateQueue.sync {
                self.hostConnected = false
                self.extensionConnected = false
                self.extensionVersion = ""
                self.extensionProtocolVersion = BridgeProtocol.version
                self.extensionCapabilities = []
                self.hostVersion = 0
                self.hostCapabilities = []
                self.didSendClientHello = false
                self.browserBundleIdentifier = nil
                let callbacks = Array(self.pending.values)
                self.pending.removeAll()
                return callbacks
            }
            let newChatCallbacks: [(NewChatUpdate) -> Void] = self.stateQueue.sync {
                let callbacks = Array(self.pendingNewChats.values)
                self.pendingNewChats.removeAll()
                return callbacks
            }
            pending.forEach { $0(.failed("浏览器连接已断开")) }
            newChatCallbacks.forEach { $0(.failed("浏览器连接已断开")) }
            self.emitStatus()
        }
        socket.onMessage = { [weak self] message in
            self?.handleMessage(message)
        }
        try socket.start()
        emitStatus()
    }

    func stop() {
        socket.stop()
    }

    /// Returns false when no extension is connected. Completion receives an
    /// accepted phase, progress reports while the extension prepares and sends,
    /// then exactly one final result, or a timeout.
    @discardableResult
    func sendPrompt(
        _ text: String,
        promptMode: PromptModeChoice,
        update: @escaping (BridgeSendUpdate) -> Void
    ) -> Bool {
        sendPrompt(text, promptMode: promptMode, newChat: false, update: update)
    }

    /// Returns false when no extension is connected. When `newChat` is set and
    /// the extension supports it, the reset happens before the send and the
    /// extension gets a longer window to finish it.
    @discardableResult
    func sendPrompt(
        _ text: String,
        promptMode: PromptModeChoice,
        newChat: Bool,
        update: @escaping (BridgeSendUpdate) -> Void
    ) -> Bool {
        let prompt: String
        switch PromptInput.normalized(text) {
        case .success(let value):
            prompt = value
        case .failure:
            update(.failed("输入内容为空"))
            return false
        }

        let supportsNewChat = stateQueue.sync {
            extensionConnected
                && extensionCapabilities.contains("newChat")
                && hostCapabilities.contains("newChat")
        }
        guard stateQueue.sync(execute: { extensionConnected }) else {
            update(.failed("浏览器未连接，请先启动 Chrome 或 Edge"))
            return false
        }

        let requestId = UUID().uuidString
        stateQueue.sync {
            pending[requestId] = update
        }

        let includeNewChat = newChat && supportsNewChat
        do {
            try socket.send(BridgeMessages.sendPrompt(
                requestId: requestId,
                text: prompt,
                promptMode: promptMode,
                newChat: includeNewChat
            ))
        } catch {
            complete(requestId, failure: "无法连接桌面桥")
            return false
        }

        // A send that first resets every panel takes noticeably longer than a
        // plain send; the extension times out at 90 seconds.
        DispatchQueue.main.asyncAfter(deadline: .now() + (includeNewChat ? 95 : 50)) { [weak self] in
            self?.complete(requestId, failure: "Panelize 未及时响应")
        }
        return true
    }

    /// Asks the extension to create fresh conversations for every panel.
    @discardableResult
    func requestNewChat(requestId: String, update: @escaping (NewChatUpdate) -> Void) -> Bool {
        let supported = stateQueue.sync {
            extensionConnected
                && extensionCapabilities.contains("newChat")
                && hostCapabilities.contains("newChat")
        }
        guard supported else {
            update(.failed("请更新扩展或确认浏览器已连接"))
            return false
        }
        guard PromptInput.isValidRequestId(requestId) else {
            update(.failed("请求无效"))
            return false
        }

        stateQueue.sync {
            pendingNewChats[requestId] = update
        }
        do {
            try socket.send(BridgeMessages.newChat(requestId: requestId))
        } catch {
            completeNewChat(requestId, failure: "无法连接桌面桥")
            return false
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 95) { [weak self] in
            self?.completeNewChat(requestId, failure: "Panelize 未及时响应")
        }
        return true
    }

    /// Sends a history request, throttled so repeatedly opening the composer
    /// does not flood the extension.
    func requestHistorySync(force: Bool = false) {
        guard stateQueue.sync(execute: {
            extensionConnected
                && extensionCapabilities.contains("historySync")
                && hostCapabilities.contains("historySync")
        }) else {
            return
        }
        let now = Date()
        guard force || now.timeIntervalSince(lastHistoryRequestAt) >= 15 else {
            return
        }
        lastHistoryRequestAt = now
        try? socket.send(BridgeMessages.historyRequest())
    }

    private func handleMessage(_ message: [String: Any]) {
        guard let event = BridgeMessages.parse(message) else {
            return
        }
        let messageProtocolVersion = message["protocol"] as? Int ?? BridgeProtocol.version

        switch event {
        case .hostHello(let version, let capabilities):
            stateQueue.async {
                self.hostVersion = version
                self.hostCapabilities = capabilities
                self.emitStatus()
            }
            maybeSendClientHello()
        case .extensionHello(let version, let capabilities):
            stateQueue.async {
                self.extensionConnected = true
                self.extensionVersion = version
                self.extensionProtocolVersion = messageProtocolVersion
                self.extensionCapabilities = capabilities
                self.emitStatus()
            }
            maybeSendClientHello()
            if capabilities.contains("historySync") {
                requestHistorySync(force: true)
                // Questions typed on this Mac are also useful to the extension,
                // e.g. after its local history was cleared.
                for message in BridgeMessages.historyUpserts(records: historyStore.loadRecords()) {
                    try? socket.send(message)
                }
            }
            DispatchQueue.main.async { [weak self] in
                self?.onExtensionConnected?()
            }
        case .historySnapshot(let batch):
            if let records = snapshotAssembler.accept(
                snapshotId: batch.batchId,
                index: batch.index,
                total: batch.total,
                records: batch.records
            ) {
                mergeHistory(records)
            }
        case .historyUpsert(let batch):
            mergeHistory(batch.records)
        case .newChatResult(let outcome):
            completeNewChat(outcome.requestId, outcome: outcome)
        case .sendAccepted(let requestId):
            let callback = stateQueue.sync { pending[requestId] }
            DispatchQueue.main.async { callback?(.accepted) }
        case .sendProgress(let progress):
            let callback = stateQueue.sync { pending[progress.requestId] }
            guard let callback else { return }
            DispatchQueue.main.async { callback(.progress(progress)) }
        case .sendResult(let outcome):
            complete(outcome.requestId, outcome: outcome)
        case .bridgeError(let requestId, _, let message):
            if let requestId {
                complete(requestId, failure: message)
            }
        case .pong:
            break
        }
    }

    private func complete(_ requestId: String, outcome: SendOutcome) {
        let callback = stateQueue.sync { pending.removeValue(forKey: requestId) }
        guard callback != nil else { return }
        DispatchQueue.main.async {
            callback?(.succeeded(outcome))
        }
    }

    private func complete(_ requestId: String, failure: String) {
        let callback = stateQueue.sync { pending.removeValue(forKey: requestId) }
        guard callback != nil else { return }
        DispatchQueue.main.async {
            callback?(.failed(failure))
        }
    }

    private func mergeHistory(_ records: [PromptHistoryRecord]) {
        let merged = records.isEmpty ? historyStore.loadRecords() : historyStore.merge(records)
        DispatchQueue.main.async { [weak self] in
            self?.onHistoryChanged?(merged)
        }
    }

    private func completeNewChat(_ requestId: String, outcome: NewChatOutcome) {
        let callback = stateQueue.sync { pendingNewChats.removeValue(forKey: requestId) }
        guard let callback else { return }
        DispatchQueue.main.async {
            callback(.succeeded(outcome))
        }
    }

    private func completeNewChat(_ requestId: String, failure: String) {
        let callback = stateQueue.sync { pendingNewChats.removeValue(forKey: requestId) }
        guard let callback else { return }
        DispatchQueue.main.async {
            callback(.failed(failure))
        }
    }

    /// Tells the extension which client version it is talking to. Both sides
    /// must advertise the handshake because an older extension answers
    /// unknown message types with an error and an older host drops them.
    private func maybeSendClientHello() {
        let clientVersion: String? = stateQueue.sync {
            guard extensionConnected,
                  extensionCapabilities.contains(BridgeHostCapabilities.versionHandshake),
                  hostCapabilities.contains(BridgeHostCapabilities.versionHandshake),
                  !didSendClientHello else {
                return nil
            }
            didSendClientHello = true
            return VersionUtils.currentAppVersion()
        }
        guard let clientVersion else { return }
        do {
            try socket.send(BridgeMessages.clientHello(clientVersion: clientVersion))
        } catch {
            stateQueue.async { [weak self] in
                self?.didSendClientHello = false
            }
        }
    }

    private func emitStatus() {
        let snapshot = BridgeStatusSnapshot.make(
            hostConnected: hostConnected,
            extensionConnected: extensionConnected,
            extensionVersion: extensionVersion,
            extensionProtocolVersion: extensionProtocolVersion,
            clientVersion: VersionUtils.currentAppVersion(),
            clientProtocol: BridgeProtocol.version
        )
        DispatchQueue.main.async { [weak self] in
            self?.onStatusChange?(snapshot)
        }
    }
}

