import Foundation

/// The two shipped prompt text languages. The extension serves Simplified
/// Chinese and English, so every other macOS language falls back to English.
public enum PromptTextLanguage: String, CaseIterable, Sendable {
    case zh
    case en

    /// Resolves the system language once per process. Chinese variants use the
    /// extension's zh_CN copy; every other language uses English.
    public static func resolve(preferredLanguages: [String]) -> PromptTextLanguage {
        guard let first = preferredLanguages.first else { return .en }
        let normalized = first.lowercased().replacingOccurrences(of: "_", with: "-")
        return normalized.hasPrefix("zh") ? .zh : .en
    }

    /// Cached for the process lifetime; a macOS language change applies after
    /// the client is relaunched.
    public static let current = resolve(preferredLanguages: Locale.preferredLanguages)
}

/// One localized string in both shipped languages.
public struct PromptModeText: Equatable, Sendable {
    public let zh: String
    public let en: String

    public init(zh: String, en: String) {
        self.zh = zh
        self.en = en
    }

    public func text(in language: PromptTextLanguage) -> String {
        switch language {
        case .zh:
            return zh
        case .en:
            return en
        }
    }
}