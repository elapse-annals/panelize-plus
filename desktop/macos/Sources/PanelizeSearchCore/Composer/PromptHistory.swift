import Foundation

/// The last few questions sent from the composer, kept only on this Mac in
/// UserDefaults. They are offered back as prefix suggestions; answers are
/// never stored and nothing here crosses the native bridge.
public struct PromptHistoryStore {
    public static let defaultsKey = "recentQuestions.v1"
    public static let maxEntries = 3

    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = PromptHistoryStore.defaultsKey) {
        self.defaults = defaults
        self.key = key
    }

    /// Matches the extension's text: CRLF becomes LF and outer whitespace goes.
    public static func normalized(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Distinct questions, newest first, at most three.
    public static func reading(_ value: [String]?) -> [String] {
        guard let value else { return [] }
        var entries: [String] = []
        for item in value {
            let text = normalized(item)
            guard !text.isEmpty else { continue }
            let key = text.lowercased()
            guard !entries.contains(where: { $0.lowercased() == key }) else { continue }
            entries.append(text)
            if entries.count >= maxEntries { break }
        }
        return entries
    }

    /// Moves a question to the front, dropping an older copy of it.
    public static func adding(_ text: String, to entries: [String]) -> [String] {
        let current = reading(entries)
        let next = normalized(text)
        guard !next.isEmpty else { return current }
        let key = next.lowercased()
        return ([next] + current.filter { $0.lowercased() != key })
            .prefix(maxEntries)
            .map { $0 }
    }

    /// Questions starting with the draft, ignoring case and outer whitespace.
    /// The exact draft is left out so filling it does not re-offer it.
    public static func matches(
        _ entries: [String],
        prefix: String,
        limit: Int = PromptHistoryStore.maxEntries
    ) -> [String] {
        let needle = normalized(prefix).lowercased()
        guard !needle.isEmpty else { return [] }
        return reading(entries)
            .filter { entry in
                let key = entry.lowercased()
                return key != needle && key.hasPrefix(needle)
            }
            .prefix(limit)
            .map { $0 }
    }

    public func load() -> [String] {
        Self.reading(defaults.stringArray(forKey: key))
    }

    @discardableResult
    public func record(_ text: String) -> [String] {
        let entries = Self.adding(text, to: load())
        defaults.set(entries, forKey: key)
        return entries
    }

    public func clear() {
        defaults.removeObject(forKey: key)
    }
}
