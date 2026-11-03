import Darwin
import Foundation
import PanelizeSearchCore
import Security

enum BridgeSendUpdate {
    case accepted
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
    /// accepted phase and then exactly one final result, or a timeout.
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

private final class UnixSocketServer {
    private let queue = DispatchQueue(label: "com.panelize.search.bridge-socket")
    private let readQueue = DispatchQueue(label: "com.panelize.search.bridge-socket-read")
    private let writeLock = NSLock()
    private var listenFD: Int32 = -1
    private var clientFD: Int32 = -1
    private var token = ""
    private var socketURL: URL?
    private var tokenURL: URL?
    private var shouldRun = false

    var onMessage: (([String: Any]) -> Void)?
    var onPeerConnected: ((String?) -> Void)?
    var onPeerDisconnected: (() -> Void)?

    func start() throws {
        let fileManager = FileManager.default
        let directory = try BridgeProtocol.supportDirectory(fileManager: fileManager)
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try? fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        BridgeProtocol.clearIntentionalQuit(fileManager: fileManager)

        let socketURL = try BridgeProtocol.socketURL(fileManager: fileManager)
        let tokenURL = try BridgeProtocol.tokenURL(fileManager: fileManager)
        self.socketURL = socketURL
        self.tokenURL = tokenURL
        unlink(socketURL.path)

        token = Self.makeToken()
        try token.write(to: tokenURL, atomically: true, encoding: .utf8)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tokenURL.path)

        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            throw SocketError("无法创建本地套接字")
        }
        listenFD = descriptor

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketURL.path.utf8CString)
        guard pathBytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            close(descriptor)
            listenFD = -1
            throw SocketError("本地套接字路径过长")
        }
        withUnsafeMutablePointer(to: &address.sun_path) { sunPathPointer in
            sunPathPointer.withMemoryRebound(to: CChar.self, capacity: pathBytes.count) { destination in
                pathBytes.withUnsafeBufferPointer { source in
                    if let base = source.baseAddress {
                        memcpy(destination, base, pathBytes.count)
                    }
                }
            }
        }

        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bindResult == 0 else {
            close(descriptor)
            listenFD = -1
            throw SocketError("无法绑定本地套接字")
        }
        chmod(socketURL.path, 0o600)
        guard listen(descriptor, 1) == 0 else {
            close(descriptor)
            listenFD = -1
            throw SocketError("无法监听本地套接字")
        }

        shouldRun = true
        queue.async { [weak self] in
            self?.acceptLoop()
        }
    }

    func stop() {
        BridgeProtocol.markIntentionalQuit()
        shouldRun = false
        closeClient()
        if listenFD >= 0 {
            shutdown(listenFD, SHUT_RDWR)
            close(listenFD)
            listenFD = -1
        }
        if let socketURL {
            unlink(socketURL.path)
        }
        if let tokenURL {
            try? FileManager.default.removeItem(at: tokenURL)
        }
    }

    func send(_ message: [String: Any]) throws {
        let frame = try NativeMessagingCodec.encode(message)
        writeLock.lock()
        defer { writeLock.unlock() }
        let descriptor = clientFD
        guard descriptor >= 0 else {
            throw SocketError("原生桥未连接")
        }
        try Self.writeAll(frame, to: descriptor)
    }

    private func acceptLoop() {
        while shouldRun {
            let descriptor = accept(listenFD, nil, nil)
            guard descriptor >= 0 else {
                if shouldRun {
                    usleep(50_000)
                    continue
                }
                return
            }
            setNoSigPipe(descriptor)
            closeClient()
            writeLock.lock()
            clientFD = descriptor
            writeLock.unlock()
            readQueue.async { [weak self] in
                self?.readLoop(descriptor)
            }
        }
    }

    private func readLoop(_ descriptor: Int32) {
        var reader = NativeFrameReader()
        var authenticated = false

        while shouldRun {
            guard let header = try? Self.readExactly(4, from: descriptor), !header.isEmpty else {
                break
            }
            let frameLength = UInt32(header[header.startIndex])
                | (UInt32(header[header.startIndex + 1]) << 8)
                | (UInt32(header[header.startIndex + 2]) << 16)
                | (UInt32(header[header.startIndex + 3]) << 24)
            guard frameLength > 0, frameLength <= BridgeProtocol.maxFrameBytes else {
                break
            }
            guard let payload = try? Self.readExactly(Int(frameLength), from: descriptor),
                  !payload.isEmpty else {
                break
            }
            reader.append(header)
            reader.append(payload)

            do {
                while let message = try reader.nextMessage() {
                    if !authenticated {
                        guard message["type"] as? String == "bridgeHello",
                              message["token"] as? String == token else {
                            break
                        }
                        authenticated = true
                        let browserBundleIdentifier = (message["browserBundleId"] as? String)
                            .flatMap { $0.isEmpty ? nil : $0 }
                        DispatchQueue.main.async { [weak self] in
                            self?.onPeerConnected?(browserBundleIdentifier)
                        }
                        continue
                    }
                    DispatchQueue.main.async { [weak self] in
                        self?.onMessage?(message)
                    }
                }
            } catch {
                break
            }
        }

        let wasAuthenticated = authenticated
        writeLock.lock()
        if clientFD == descriptor {
            clientFD = -1
        }
        writeLock.unlock()
        close(descriptor)
        if wasAuthenticated {
            DispatchQueue.main.async { [weak self] in
                self?.onPeerDisconnected?()
            }
        }
    }

    private func closeClient() {
        writeLock.lock()
        let descriptor = clientFD
        clientFD = -1
        writeLock.unlock()
        if descriptor >= 0 {
            shutdown(descriptor, SHUT_RDWR)
            close(descriptor)
        }
    }

    private func setNoSigPipe(_ descriptor: Int32) {
        var one: Int32 = 1
        setsockopt(
            descriptor,
            SOL_SOCKET,
            SO_NOSIGPIPE,
            &one,
            socklen_t(MemoryLayout<Int32>.size)
        )
    }

    private static func readExactly(_ count: Int, from descriptor: Int32) throws -> Data? {
        var data = Data(capacity: count)
        while data.count < count {
            var chunk = [UInt8](repeating: 0, count: count - data.count)
            let readCount = chunk.withUnsafeMutableBytes {
                read(descriptor, $0.baseAddress, $0.count)
            }
            if readCount == 0 {
                return data.isEmpty ? nil : data
            }
            if readCount < 0 {
                if errno == EINTR { continue }
                return data.isEmpty ? nil : data
            }
            data.append(contentsOf: chunk.prefix(readCount))
        }
        return data
    }

    private static func writeAll(_ data: Data, to descriptor: Int32) throws {
        var offset = 0
        while offset < data.count {
            let written = data.withUnsafeBytes { raw in
                write(descriptor, raw.baseAddress?.advanced(by: offset), data.count - offset)
            }
            if written < 0 {
                if errno == EINTR { continue }
                throw SocketError("无法写入原生桥")
            }
            offset += written
        }
    }

    private static func makeToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let result = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if result != errSecSuccess {
            return UUID().uuidString + UUID().uuidString
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}

private struct SocketError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}