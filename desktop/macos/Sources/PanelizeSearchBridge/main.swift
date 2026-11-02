import AppKit
import Darwin
import Foundation
import PanelizeSearchCore

private final class NativeBridgeHost {
    private let outputLock = NSLock()
    private let socketWriteLock = NSLock()
    private let stateQueue = DispatchQueue(label: "com.panelize.search.native-host-state")
    private var socketFD: Int32 = -1
    private var lastExtensionHello: [String: Any]?
    private var didAttemptAppLaunch = false
    private var heartbeatTimer: DispatchSourceTimer?

    func run() -> Never {
        let readerThread = Thread { [weak self] in
            self?.readNativeMessages()
        }
        readerThread.name = "Panelize native stdin"
        readerThread.start()

        startHeartbeat()
        maintainDesktopConnection()
    }

    private func startHeartbeat() {
        let timer = DispatchSource.makeTimerSource(queue: stateQueue)
        timer.schedule(deadline: .now() + 15, repeating: 15)
        timer.setEventHandler { [weak self] in
            // Traffic keeps the MV3 service worker from going idle while the
            // browser is running and this native host is connected.
            self?.writeNativeMessage([
                "protocol": BridgeProtocol.version,
                "type": "ping"
            ])
        }
        timer.resume()
        heartbeatTimer = timer
    }

    private func readNativeMessages() {
        var reader = NativeFrameReader()
        while true {
            guard let header = readExactly(4, from: FileHandle.standardInput) else {
                exit(EXIT_SUCCESS)
            }
            let length = UInt32(header[header.startIndex])
                | (UInt32(header[header.startIndex + 1]) << 8)
                | (UInt32(header[header.startIndex + 2]) << 16)
                | (UInt32(header[header.startIndex + 3]) << 24)
            guard length > 0, length <= BridgeProtocol.maxFrameBytes else {
                exit(EXIT_FAILURE)
            }
            guard let payload = readExactly(Int(length), from: FileHandle.standardInput) else {
                exit(EXIT_SUCCESS)
            }
            reader.append(header)
            reader.append(payload)

            do {
                while let message = try reader.nextMessage() {
                    handleExtensionMessage(message)
                }
            } catch {
                exit(EXIT_FAILURE)
            }
        }
    }

    private func handleExtensionMessage(_ message: [String: Any]) {
        if message["type"] as? String == "hello" {
            stateQueue.sync {
                lastExtensionHello = message
            }
        }
        forwardToDesktop(message)
    }

    private func maintainDesktopConnection() -> Never {
        while true {
            if socketFD < 0 {
                connectToDesktop()
            }
            if socketFD < 0 {
                usleep(400_000)
                continue
            }
            serveDesktopSocket(socketFD)
            stateQueue.sync {
                if socketFD >= 0 {
                    close(socketFD)
                    socketFD = -1
                }
            }
            usleep(300_000)
        }
    }

    private func connectToDesktop() {
        let fileManager = FileManager.default
        guard let socketURL = try? BridgeProtocol.socketURL(fileManager: fileManager) else {
            return
        }
        let tokenURL = try? BridgeProtocol.tokenURL(fileManager: fileManager)
        guard let tokenURL, let token = try? String(contentsOf: tokenURL, encoding: .utf8), !token.isEmpty else {
            if !didAttemptAppLaunch {
                didAttemptAppLaunch = true
                launchDesktopApp()
            }
            return
        }

        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            return
        }
        var one: Int32 = 1
        setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketURL.path.utf8CString)
        guard pathBytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            close(descriptor)
            return
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
        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard result == 0 else {
            close(descriptor)
            if !didAttemptAppLaunch {
                didAttemptAppLaunch = true
                launchDesktopApp()
            }
            return
        }

        do {
            try writeAll(
                try NativeMessagingCodec.encode(BridgeMessages.tokenHandshake(token)),
                to: descriptor
            )
            socketWriteLock.lock()
            socketFD = descriptor
            socketWriteLock.unlock()

            let hello = stateQueue.sync { lastExtensionHello }
            if let hello {
                forwardToDesktop(hello)
            }
        } catch {
            close(descriptor)
        }
    }

    private func serveDesktopSocket(_ descriptor: Int32) {
        var reader = NativeFrameReader()
        while true {
            guard let header = readExactly(4, fromFD: descriptor) else {
                return
            }
            let length = UInt32(header[header.startIndex])
                | (UInt32(header[header.startIndex + 1]) << 8)
                | (UInt32(header[header.startIndex + 2]) << 16)
                | (UInt32(header[header.startIndex + 3]) << 24)
            guard length > 0, length <= BridgeProtocol.maxFrameBytes,
                  let payload = readExactly(Int(length), fromFD: descriptor) else {
                return
            }
            reader.append(header)
            reader.append(payload)
            do {
                while let message = try reader.nextMessage() {
                    guard message["type"] as? String == "sendPrompt",
                          let requestId = message["requestId"] as? String,
                          let text = message["text"] as? String,
                          PromptInput.isValidRequestId(requestId),
                          case .success = PromptInput.normalized(text) else {
                        continue
                    }
                    writeNativeMessage(BridgeMessages.sendPrompt(
                        requestId: requestId,
                        text: text,
                        promptMode: PromptModeChoice.wireValue(from: message)
                    ))
                }
            } catch {
                return
            }
        }
    }

    private func forwardToDesktop(_ message: [String: Any]) {
        socketWriteLock.lock()
        let descriptor = socketFD
        socketWriteLock.unlock()
        guard descriptor >= 0 else {
            return
        }
        do {
            try writeAll(try NativeMessagingCodec.encode(message), to: descriptor)
        } catch {
            stateQueue.sync {
                if socketFD == descriptor {
                    socketFD = -1
                }
            }
        }
    }

    private func writeNativeMessage(_ message: [String: Any]) {
        guard let frame = try? NativeMessagingCodec.encode(message) else {
            return
        }
        outputLock.lock()
        defer { outputLock.unlock() }
        FileHandle.standardOutput.write(frame)
    }

    private func launchDesktopApp() {
        // Never resurrect an app the user explicitly quit; opening it again
        // clears the marker.
        let intentionalQuit = BridgeProtocol.isIntentionalQuit()
        FileHandle.standardError.write(
            Data("[PanelizeSearchBridge] launch requested quit=\(intentionalQuit)\n".utf8)
        )
        if intentionalQuit {
            return
        }
        guard let appURL = locateAppBundle() else {
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { _, error in
            if let error {
                FileHandle.standardError.write(
                    Data("[PanelizeSearchBridge] Could not launch app: \(error)\n".utf8)
                )
            }
        }
    }

    private func locateAppBundle() -> URL? {
        var url = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        while url.path != "/" {
            if url.pathExtension == "app" {
                return url
            }
            url.deleteLastPathComponent()
        }
        return Bundle.main.bundleURL.pathExtension == "app" ? Bundle.main.bundleURL : nil
    }

    private func readExactly(_ count: Int, from fileHandle: FileHandle) -> Data? {
        var data = Data()
        while data.count < count {
            guard let chunk = try? fileHandle.read(upToCount: count - data.count),
                  !chunk.isEmpty else {
                return nil
            }
            data.append(chunk)
        }
        return data
    }

    private func readExactly(_ count: Int, fromFD descriptor: Int32) -> Data? {
        var data = Data(capacity: count)
        while data.count < count {
            var chunk = [UInt8](repeating: 0, count: count - data.count)
            let readCount = chunk.withUnsafeMutableBytes {
                read(descriptor, $0.baseAddress, $0.count)
            }
            if readCount == 0 {
                return nil
            }
            if readCount < 0 {
                if errno == EINTR { continue }
                return nil
            }
            data.append(contentsOf: chunk.prefix(readCount))
        }
        return data
    }

    private func writeAll(_ data: Data, to descriptor: Int32) throws {
        var offset = 0
        while offset < data.count {
            let written = data.withUnsafeBytes { raw in
                write(descriptor, raw.baseAddress?.advanced(by: offset), data.count - offset)
            }
            if written < 0 {
                if errno == EINTR { continue }
                throw BridgeHostError.writeFailed
            }
            offset += written
        }
    }
}

private enum BridgeHostError: Error {
    case writeFailed
}

private let host = NativeBridgeHost()
host.run()