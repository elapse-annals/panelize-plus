import Darwin
import Foundation
import PanelizeSearchCore
import Security

final class UnixSocketServer {
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