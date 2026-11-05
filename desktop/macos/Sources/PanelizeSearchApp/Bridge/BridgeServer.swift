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

final class BridgeServer {
    private let socket = UnixSocketServer()
    private let stateQueue = DispatchQueue(label: "com.panelize.search.bridge-state")
    private var pending: [String: (BridgeSendUpdate) -> Void] = [:]
    private var extensionVersion = ""
    private var browserBundleIdentifier: String?
    private var hostConnected = false
    private var extensionConnected = false

    var onStatusChange: ((String) -> Void)?
    var onExtensionConnected: (() -> Void)?

    var isReady: Bool {
        stateQueue.sync { hostConnected && extensionConnected }
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
                self.browserBundleIdentifier = nil
                let callbacks = Array(self.pending.values)
                self.pending.removeAll()
                return callbacks
            }
            pending.forEach { $0(.failed("浏览器连接已断开")) }
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
        let prompt: String
        switch PromptInput.normalized(text) {
        case .success(let value):
            prompt = value
        case .failure:
            update(.failed("输入内容为空"))
            return false
        }

        guard stateQueue.sync(execute: { extensionConnected }) else {
            update(.failed("浏览器未连接，请先启动 Chrome 或 Edge"))
            return false
        }

        let requestId = UUID().uuidString
        stateQueue.sync {
            pending[requestId] = update
        }

        do {
            try socket.send(BridgeMessages.sendPrompt(
                requestId: requestId,
                text: prompt,
                promptMode: promptMode
            ))
        } catch {
            complete(requestId, failure: "无法连接桌面桥")
            return false
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 50) { [weak self] in
            self?.complete(requestId, failure: "Panelize 未及时响应")
        }
        return true
    }

    private func handleMessage(_ message: [String: Any]) {
        guard let event = BridgeMessages.parse(message) else {
            return
        }

        switch event {
        case .extensionHello(let version):
            stateQueue.async {
                self.extensionConnected = true
                self.extensionVersion = version
                self.emitStatus()
            }
            DispatchQueue.main.async { [weak self] in
                self?.onExtensionConnected?()
            }
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

    private func emitStatus() {
        let status: String
        if extensionConnected {
            status = extensionVersion.isEmpty
                ? "Panelize 已连接"
                : "Panelize \(extensionVersion) 已连接"
        } else if hostConnected {
            status = "原生桥已连接，等待扩展"
        } else {
            status = "浏览器未连接"
        }
        DispatchQueue.main.async { [weak self] in
            self?.onStatusChange?(status)
        }
    }
}

