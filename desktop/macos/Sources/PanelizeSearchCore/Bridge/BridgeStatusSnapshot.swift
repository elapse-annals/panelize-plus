import Foundation

/// Everything the menu bar and composer need to describe the bridge in one
/// immutable value. Keeping readiness typed avoids parsing localized text.
public struct BridgeStatusSnapshot: Equatable {
    public let text: String
    public let menuTitle: String
    public let ready: Bool
    public let hostConnected: Bool
    public let extensionConnected: Bool
    public let extensionVersion: String
    public let extensionProtocolVersion: Int
    public let compatibility: VersionCompatibilityLevel
    public let versionHint: String?

    public init(
        text: String,
        menuTitle: String,
        ready: Bool,
        hostConnected: Bool,
        extensionConnected: Bool,
        extensionVersion: String,
        extensionProtocolVersion: Int,
        compatibility: VersionCompatibilityLevel,
        versionHint: String?
    ) {
        self.text = text
        self.menuTitle = menuTitle
        self.ready = ready
        self.hostConnected = hostConnected
        self.extensionConnected = extensionConnected
        self.extensionVersion = extensionVersion
        self.extensionProtocolVersion = extensionProtocolVersion
        self.compatibility = compatibility
        self.versionHint = versionHint
    }

    public static func make(
        hostConnected: Bool,
        extensionConnected: Bool,
        extensionVersion: String,
        extensionProtocolVersion: Int = BridgeProtocol.version,
        clientVersion: String,
        clientProtocol: Int = BridgeProtocol.version
    ) -> BridgeStatusSnapshot {
        let trimmedVersion = extensionVersion.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayVersion = VersionUtils.normalizedVersion(trimmedVersion) ?? trimmedVersion
        let hasExtensionVersion = extensionConnected && !trimmedVersion.isEmpty

        let compatibility: VersionCompatibilityLevel
        let hint: String?
        if hasExtensionVersion {
            compatibility = VersionUtils.compatibilityLevel(
                clientVersion: clientVersion,
                extensionVersion: trimmedVersion,
                clientProtocol: clientProtocol,
                extensionProtocol: extensionProtocolVersion
            )
            hint = VersionUtils.versionHint(
                level: compatibility,
                clientVersion: clientVersion,
                extensionVersion: trimmedVersion,
                clientProtocol: clientProtocol,
                extensionProtocol: extensionProtocolVersion
            )
        } else {
            compatibility = .unknown
            hint = nil
        }

        let text: String
        let menuTitle: String
        if extensionConnected {
            if hasExtensionVersion {
                text = "Panelize \(displayVersion) 已连接"
                menuTitle = "浏览器：已连接 (v\(displayVersion))"
            } else {
                text = "Panelize 已连接"
                menuTitle = "浏览器：已连接"
            }
        } else if hostConnected {
            text = "原生桥已连接，等待扩展"
            menuTitle = "浏览器：等待扩展"
        } else {
            text = "浏览器未连接"
            menuTitle = "浏览器：未连接"
        }

        return BridgeStatusSnapshot(
            text: text,
            menuTitle: hint.map { "\(menuTitle) · \($0)" } ?? menuTitle,
            ready: hostConnected && extensionConnected,
            hostConnected: hostConnected,
            extensionConnected: extensionConnected,
            extensionVersion: trimmedVersion,
            extensionProtocolVersion: extensionProtocolVersion,
            compatibility: compatibility,
            versionHint: hint
        )
    }

    public static func bridgeUnavailable(_ text: String = "本地桥启动失败") -> BridgeStatusSnapshot {
        BridgeStatusSnapshot(
            text: text,
            menuTitle: "浏览器：\(text)",
            ready: false,
            hostConnected: false,
            extensionConnected: false,
            extensionVersion: "",
            extensionProtocolVersion: BridgeProtocol.version,
            compatibility: .unknown,
            versionHint: nil
        )
    }
}
