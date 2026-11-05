import AppKit
import Darwin
import Foundation
import PanelizeSearchCore

final class NativeBridgeHost {
    private let nativeIO = NativeMessageIO()
    private let socketWriteLock = NSLock()
    private let stateQueue = DispatchQueue(label: "com.panelize.search.native-host-state")
    private var socketFD: Int32 = -1
    private var lastExtensionHello: [String: Any]?
    private var didAttemptAppLaunch = false
    private var heartbeatTimer: DispatchSourceTimer?

    func run() -> Never {
        let readerThread = Thread { [weak self] in
            self?.nativeIO.readMessages { [weak self] message in
                self?.handleExtensionMessage(message)
            }
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
            self?.nativeIO.write([
                "protocol": BridgeProtocol.version,
                "type": "ping"
            ])
        }
        timer.resume()
        heartbeatTimer = timer
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

        let descriptor: Int32
        do {
            descriptor = try UnixSocketClient.connect(to: socketURL)
        } catch SocketConnectionError.connectionFailed {
            if !didAttemptAppLaunch {
                didAttemptAppLaunch = true
                launchDesktopApp()
            }
            return
        } catch {
            return
        }

        do {
            try UnixSocketClient.writeAll(
                try NativeMessagingCodec.encode(BridgeMessages.tokenHandshake(
                    token,
                    browserBundleIdentifier: browserBundleIdentifier()
                )),
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
            guard let header = UnixSocketClient.readExactly(4, fromFD: descriptor) else {
                return
            }
            let length = UInt32(header[header.startIndex])
                | (UInt32(header[header.startIndex + 1]) << 8)
                | (UInt32(header[header.startIndex + 2]) << 16)
                | (UInt32(header[header.startIndex + 3]) << 24)
            guard length > 0, length <= BridgeProtocol.maxFrameBytes,
                  let payload = UnixSocketClient.readExactly(Int(length), fromFD: descriptor) else {
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
                    nativeIO.write(BridgeMessages.sendPrompt(
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
            try UnixSocketClient.writeAll(try NativeMessagingCodec.encode(message), to: descriptor)
        } catch {
            stateQueue.sync {
                if socketFD == descriptor {
                    socketFD = -1
                }
            }
        }
    }

    /// The browser launches this host as its child, so the parent process is
    /// the browser app whose window the client should bring forward. A helper
    /// bundle identifier is trimmed back to the browser's own identifier.
    private func browserBundleIdentifier() -> String? {
        guard let identifier = NSRunningApplication(processIdentifier: getppid())?.bundleIdentifier,
              !identifier.isEmpty else {
            return nil
        }
        if let helperRange = identifier.range(of: ".helper") {
            return String(identifier[..<helperRange.lowerBound])
        }
        return identifier
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

}

