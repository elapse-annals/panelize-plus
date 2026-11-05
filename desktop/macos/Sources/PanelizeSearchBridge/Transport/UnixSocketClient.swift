import Darwin
import Foundation

/// Unix-socket transport; request routing and reconnect policy stay in the host.
enum UnixSocketClient {
    static func connect(to socketURL: URL) throws -> Int32 {
        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            throw SocketConnectionError.socketCreationFailed
        }
        var one: Int32 = 1
        setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketURL.path.utf8CString)
        guard pathBytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            close(descriptor)
            throw SocketConnectionError.invalidPath
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
                Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard result == 0 else {
            close(descriptor)
            throw SocketConnectionError.connectionFailed
        }
        return descriptor
    }

    static func readExactly(_ count: Int, fromFD descriptor: Int32) -> Data? {
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

    static func writeAll(_ data: Data, to descriptor: Int32) throws {
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

enum BridgeHostError: Error {
    case writeFailed
}

enum SocketConnectionError: Error {
    case socketCreationFailed
    case invalidPath
    case connectionFailed
}
