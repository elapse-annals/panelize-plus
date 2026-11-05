import Foundation
import PanelizeSearchCore

/// Reads and writes the browser Native Messaging stream.
final class NativeMessageIO {
    private let outputLock = NSLock()

    func readMessages(onMessage: ([String: Any]) -> Void) {
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
                    onMessage(message)
                }
            } catch {
                exit(EXIT_FAILURE)
            }
        }
    }

    func write(_ message: [String: Any]) {
        guard let frame = try? NativeMessagingCodec.encode(message) else {
            return
        }
        outputLock.lock()
        defer { outputLock.unlock() }
        FileHandle.standardOutput.write(frame)
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
}
