import Foundation

public enum BridgeProtocol {
    public static let version = 1
    public static let hostName = "com.panelize.global_sender"
    public static let maxFrameBytes = 1_048_576
    public static let maxPromptCharacters = 8000
    public static let maxRequestIdLength = 100
    public static let maxProgressNames = 24
    public static let maxProgressNameLength = 60
    /// Lets an isolated app and native host (integration tests, a parallel
    /// instance) use their own socket and token instead of the installed
    /// client's application-support directory.
    public static let supportDirectoryOverrideKey = "PANELIZE_BRIDGE_SUPPORT_DIR"
    public static let appBundleIdentifier = "com.panelize.search"
    public static let appName = "Panelize Link"

    public static func supportDirectory(
        fileManager: FileManager = .default
    ) throws -> URL {
        if let override = ProcessInfo.processInfo.environment[supportDirectoryOverrideKey],
           !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        let base = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return base.appendingPathComponent(appName, isDirectory: true)
    }

    public static func socketURL(fileManager: FileManager = .default) throws -> URL {
        try supportDirectory(fileManager: fileManager).appendingPathComponent("bridge.sock")
    }

    public static func tokenURL(fileManager: FileManager = .default) throws -> URL {
        try supportDirectory(fileManager: fileManager).appendingPathComponent("bridge.token")
    }

    public static func quitMarkerURL(fileManager: FileManager = .default) throws -> URL {
        try supportDirectory(fileManager: fileManager).appendingPathComponent("app.quit")
    }

    /// A clean quit must not be undone by the native host's launch-on-demand
    /// behavior. The marker is removed the next time the app starts.
    public static func markIntentionalQuit(fileManager: FileManager = .default) {
        guard let url = try? quitMarkerURL(fileManager: fileManager) else { return }
        try? Data("1".utf8).write(to: url)
    }

    public static func clearIntentionalQuit(fileManager: FileManager = .default) {
        guard let url = try? quitMarkerURL(fileManager: fileManager) else { return }
        try? fileManager.removeItem(at: url)
    }

    public static func isIntentionalQuit(fileManager: FileManager = .default) -> Bool {
        guard let url = try? quitMarkerURL(fileManager: fileManager) else {
            return false
        }
        return fileManager.fileExists(atPath: url.path)
    }
}

public enum PromptValidationError: String, Error, Equatable {
    case empty
    case tooLong
}

public enum PromptInput {
    /// Matches the extension's JavaScript normalizer: CRLF becomes LF, outer
    /// whitespace is removed, and limits count Unicode code points.
    public static func normalized(_ value: String) -> Result<String, PromptValidationError> {
        let text = value
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return .failure(.empty)
        }
        guard text.unicodeScalars.count <= BridgeProtocol.maxPromptCharacters else {
            return .failure(.tooLong)
        }
        return .success(text)
    }

    public static func isValidRequestId(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty
            && trimmed.count <= BridgeProtocol.maxRequestIdLength
            && trimmed == value
    }
}

public enum NativeMessagingCodec {
    public static func encode(_ message: [String: Any]) throws -> Data {
        let payload = try JSONSerialization.data(withJSONObject: message)
        guard !payload.isEmpty, payload.count <= BridgeProtocol.maxFrameBytes else {
            throw NativeFrameError.messageTooLarge
        }
        var length = UInt32(payload.count).littleEndian
        var frame = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
        frame.append(payload)
        return frame
    }
}

public enum NativeFrameError: Error, Equatable {
    case invalidLength
    case messageTooLarge
    case invalidJSON
}

public struct NativeFrameReader {
    private var buffer = Data()

    public init() {}

    public mutating func append(_ data: Data) {
        buffer.append(data)
    }

    /// Returns nil when more bytes are needed. A zero-length or oversized frame
    /// is rejected rather than skipped.
    public mutating func nextMessage() throws -> [String: Any]? {
        guard buffer.count >= 4 else {
            return nil
        }

        let start = buffer.startIndex
        let length = UInt32(buffer[start])
            | (UInt32(buffer[start + 1]) << 8)
            | (UInt32(buffer[start + 2]) << 16)
            | (UInt32(buffer[start + 3]) << 24)
        guard length > 0, length <= BridgeProtocol.maxFrameBytes else {
            throw length == 0 ? NativeFrameError.invalidLength : NativeFrameError.messageTooLarge
        }

        let total = 4 + Int(length)
        guard buffer.count >= total else {
            return nil
        }

        let payload = buffer.subdata(in: 4..<total)
        buffer.removeSubrange(0..<total)
        guard let object = try? JSONSerialization.jsonObject(with: payload),
              var message = object as? [String: Any] else {
            throw NativeFrameError.invalidJSON
        }
        if message["protocol"] == nil {
            message["protocol"] = BridgeProtocol.version
        }
        return message
    }
}

public struct SendOutcome: Equatable {
    public let requestId: String
    public let ok: Bool
    public let sent: Int
    public let total: Int
    public let reason: String

    public init(requestId: String, ok: Bool, sent: Int, total: Int, reason: String = "") {
        self.requestId = requestId
        self.ok = ok
        self.sent = sent
        self.total = total
        self.reason = reason
    }
}

/// One progress report for a send. `opening` means the Multi-Panel page was
/// created or reused; `preparing` carries how many AI panels can take the
/// question; `sending` means the prompt is being handed to them.
public enum SendProgressStage: String, Equatable {
    case opening
    case preparing
    case sending
}

public struct SendProgress: Equatable {
    public let requestId: String
    public let stage: SendProgressStage
    public let ready: Int
    public let total: Int
    public let pendingCount: Int
    public let timedOutCount: Int
    public let pendingNames: [String]
    public let timedOutNames: [String]
    public let blind: Bool

    public init(
        requestId: String,
        stage: SendProgressStage,
        ready: Int = 0,
        total: Int = 0,
        pendingCount: Int = 0,
        timedOutCount: Int = 0,
        pendingNames: [String] = [],
        timedOutNames: [String] = [],
        blind: Bool = false
    ) {
        self.requestId = requestId
        self.stage = stage
        self.ready = ready
        self.total = total
        self.pendingCount = pendingCount
        self.timedOutCount = timedOutCount
        self.pendingNames = pendingNames
        self.timedOutNames = timedOutNames
        self.blind = blind
    }

    /// A send with the same stage, counts and names is a repeated update the
    /// client should not redraw.
    public var signature: String {
        [
            stage.rawValue,
            String(ready),
            String(total),
            String(pendingCount),
            String(timedOutCount),
            blind ? "blind" : "named",
            pendingNames.joined(separator: "\u{1F}"),
            timedOutNames.joined(separator: "\u{1F}")
        ].joined(separator: "\u{1E}")
    }
}

public enum BridgeEvent {
    case extensionHello(version: String)
    case sendAccepted(requestId: String)
    case sendProgress(SendProgress)
    case sendResult(SendOutcome)
    case bridgeError(requestId: String?, code: String, message: String)
    case pong
}

public enum BridgeMessages {
    public static func sendPrompt(
        requestId: String,
        text: String,
        promptMode: PromptModeChoice? = nil
    ) -> [String: Any] {
        var message: [String: Any] = [
            "protocol": BridgeProtocol.version,
            "type": "sendPrompt",
            "requestId": requestId,
            "text": text
        ]
        if let promptMode {
            message["promptMode"] = promptMode.rawValue
        }
        return message
    }

    public static func tokenHandshake(
        _ token: String,
        browserBundleIdentifier: String? = nil
    ) -> [String: Any] {
        var message: [String: Any] = [
            "protocol": BridgeProtocol.version,
            "type": "bridgeHello",
            "token": token
        ]
        if let browserBundleIdentifier, !browserBundleIdentifier.isEmpty {
            message["browserBundleId"] = browserBundleIdentifier
        }
        return message
    }

    private static func progressCount(_ value: Any?, limit: Int?) -> Int {
        let count = max(0, value as? Int ?? 0)
        guard let limit else { return count }
        return min(count, max(0, limit))
    }

    private static func progressNames(_ value: Any?) -> [String] {
        guard let names = value as? [String] else { return [] }
        let cleaned = names.compactMap { name -> String? in
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            return String(trimmed.prefix(BridgeProtocol.maxProgressNameLength))
        }
        return Array(cleaned.prefix(BridgeProtocol.maxProgressNames))
    }

    public static func parse(_ message: [String: Any]) -> BridgeEvent? {
        guard let type = message["type"] as? String else {
            return nil
        }
        switch type {
        case "hello":
            return .extensionHello(version: message["extensionVersion"] as? String ?? "")
        case "sendAccepted":
            guard let requestId = message["requestId"] as? String else {
                return nil
            }
            return .sendAccepted(requestId: requestId)
        case "sendProgress":
            guard let requestId = message["requestId"] as? String,
                  !requestId.isEmpty,
                  let rawStage = message["stage"] as? String,
                  let stage = SendProgressStage(rawValue: rawStage) else {
                return nil
            }
            let total = max(0, message["total"] as? Int ?? 0)
            let reportedReady = max(0, message["ready"] as? Int ?? 0)
            let ready = total > 0 ? min(reportedReady, total) : reportedReady
            let available = total > 0 ? max(0, total - ready) : nil
            let pendingCount = progressCount(message["pendingCount"], limit: available)
            let timedOutCount = progressCount(
                message["timedOutCount"],
                limit: available.map { max(0, $0 - pendingCount) }
            )
            let blind = message["blind"] as? Bool ?? false
            return .sendProgress(SendProgress(
                requestId: requestId,
                stage: stage,
                ready: ready,
                total: total,
                pendingCount: pendingCount,
                timedOutCount: timedOutCount,
                pendingNames: blind ? [] : progressNames(message["pendingNames"]),
                timedOutNames: blind ? [] : progressNames(message["timedOutNames"]),
                blind: blind
            ))
        case "sendResult":
            guard let requestId = message["requestId"] as? String else {
                return nil
            }
            let sent = message["sent"] as? Int ?? 0
            let total = message["total"] as? Int ?? 0
            return .sendResult(SendOutcome(
                requestId: requestId,
                ok: message["ok"] as? Bool ?? false,
                sent: max(0, sent),
                total: max(0, total),
                reason: message["reason"] as? String ?? ""
            ))
        case "error":
            return .bridgeError(
                requestId: message["requestId"] as? String,
                code: message["code"] as? String ?? "unknown",
                message: message["message"] as? String ?? "Panelize reported an error"
            )
        case "pong":
            return .pong
        default:
            return nil
        }
    }

    public static func errorReason(_ reason: String) -> String {
        switch reason {
        case "empty-text", "empty":
            return "输入内容为空"
        case "text-too-long":
            return "内容过长（最多 8000 字符）"
        case "preparing":
            return "AI 仍在加载，请稍后重试"
        case "new-chat-busy":
            return "正在新建会话，请稍后重试"
        case "busy":
            return "Panelize 正忙，请稍后重试"
        case "send-failed", "send-error":
            return "没有 AI 接收这条消息"
        case "no-response":
            return "Panelize 未及时响应"
        case "not-connected":
            return "浏览器未连接"
        default:
            return reason.isEmpty ? "发送失败" : reason
        }
    }
}