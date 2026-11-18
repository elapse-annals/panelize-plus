import Foundation

/// How compatible the running browser extension and the macOS client are.
/// A patch-level difference is compatible; a minor bump only recommends
/// aligning them; a major or protocol mismatch is a stronger warning.
public enum VersionCompatibilityLevel: String, Equatable {
    case compatible
    case minor
    case major
    case unknown
}

public enum VersionUtils {
    /// Used only when the app does not run from a bundle (tests, CLI). The
    /// packaged app reads CFBundleShortVersionString written by build-app.sh.
    public static let fallbackAppVersion = "2.95.0"

    /// Compares two `x.y.z` versions. Invalid or missing versions compare as
    /// equal so callers can detect them through `normalizedVersion` instead.
    public static func compareVersions(_ first: String, _ second: String) -> ComparisonResult {
        guard let left = parse(first), let right = parse(second) else {
            return .orderedSame
        }
        for index in 0..<3 {
            if left[index] < right[index] {
                return .orderedAscending
            }
            if left[index] > right[index] {
                return .orderedDescending
            }
        }
        return .orderedSame
    }

    /// Returns the canonical three-component version without a leading `v`,
    /// or nil when the string is not a numeric `x.y.z`.
    public static func normalizedVersion(_ version: String) -> String? {
        guard let components = parse(version) else { return nil }
        return components.map(String.init).joined(separator: ".")
    }

    public static func compatibilityLevel(
        clientVersion: String,
        extensionVersion: String,
        clientProtocol: Int = BridgeProtocol.version,
        extensionProtocol: Int = BridgeProtocol.version
    ) -> VersionCompatibilityLevel {
        guard let client = parse(clientVersion), let ext = parse(extensionVersion) else {
            return .unknown
        }
        if clientProtocol != extensionProtocol || client[0] != ext[0] {
            return .major
        }
        if client[1] != ext[1] {
            return .minor
        }
        return .compatible
    }

    public static func versionHint(
        level: VersionCompatibilityLevel,
        clientVersion: String,
        extensionVersion: String,
        clientProtocol: Int = BridgeProtocol.version,
        extensionProtocol: Int = BridgeProtocol.version
    ) -> String? {
        guard level == .minor || level == .major else { return nil }
        if clientProtocol != extensionProtocol {
            return "客户端与扩展协议版本不一致，建议更新"
        }
        guard let client = parse(clientVersion), let ext = parse(extensionVersion) else {
            return nil
        }
        let extensionIsOlder = compareComponents(ext, client) == .orderedAscending
        switch level {
        case .minor:
            return extensionIsOlder ? "扩展版本较旧，建议更新" : "macOS 客户端版本较旧，建议更新"
        case .major:
            return extensionIsOlder ? "扩展版本过旧，建议更新" : "macOS 客户端版本较旧，建议更新"
        case .compatible, .unknown:
            return nil
        }
    }

    public static func currentAppVersion(
        bundle: Bundle = .main,
        fallback: String = fallbackAppVersion
    ) -> String {
        currentAppVersion(infoDictionary: bundle.infoDictionary, fallback: fallback)
    }

    public static func currentAppVersion(
        infoDictionary: [String: Any]?,
        fallback: String = fallbackAppVersion
    ) -> String {
        if let raw = infoDictionary?["CFBundleShortVersionString"] as? String {
            let version = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !version.isEmpty {
                return version
            }
        }
        return fallback
    }

    private static func parse(_ version: String) -> [Int]? {
        let trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
        let withoutPrefix = trimmed.hasPrefix("v") || trimmed.hasPrefix("V")
            ? String(trimmed.dropFirst())
            : trimmed
        let parts = withoutPrefix.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var numbers: [Int] = []
        numbers.reserveCapacity(3)
        for part in parts {
            guard !part.isEmpty,
                  part.allSatisfy({ $0.isASCII && $0.isNumber }),
                  let value = Int(part) else {
                return nil
            }
            numbers.append(value)
        }
        return numbers
    }

    private static func compareComponents(_ first: [Int], _ second: [Int]) -> ComparisonResult {
        for index in 0..<3 {
            if first[index] < second[index] {
                return .orderedAscending
            }
            if first[index] > second[index] {
                return .orderedDescending
            }
        }
        return .orderedSame
    }
}
