import Foundation

/// A summary generated in the extension, stored with the question. Only the
/// precomputed plain text crosses the native bridge; provider labels are
/// already anonymized there when the summary came from blind mode.
public struct PromptHistorySummary: Equatable, Codable {
    public let blind: Bool
    public let formattedText: String
    public let createdAtMillis: Double

    public init(blind: Bool, formattedText: String, createdAtMillis: Double) {
        self.blind = blind
        self.formattedText = formattedText
        self.createdAtMillis = createdAtMillis
    }
}

public struct PromptHistoryRecord: Equatable, Codable {
    public let text: String
    public let createdAtMillis: Double
    public let updatedAtMillis: Double
    public let summary: PromptHistorySummary?

    public init(
        text: String,
        createdAtMillis: Double,
        updatedAtMillis: Double,
        summary: PromptHistorySummary? = nil
    ) {
        self.text = text
        self.createdAtMillis = createdAtMillis
        self.updatedAtMillis = updatedAtMillis
        self.summary = summary
    }

    public var key: String {
        text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    public var hasSummary: Bool {
        summary?.formattedText.isEmpty == false
    }
}

private struct StoredHistory: Codable {
    let version: Int
    let records: [PromptHistoryRecord]
}

/// The last three days of questions (with their summaries) kept on this Mac.
/// The latest run offers a short prefix list above the input; the history
/// browser reads the full record list.
public struct PromptHistoryStore {
    public static let defaultsKey = "questionHistory.v1"
    public static let legacyDefaultsKey = "recentQuestions.v1"
    public static let maxEntries = 3
    public static let ttlMillis: Double = 3 * 24 * 60 * 60 * 1000
    public static let maxTextCharacters = 20_000
    public static let maxSummaryCharacters = 150_000
    private static let storedVersion = 1
    private static let clockSkewMillis: Double = 5 * 60 * 1000

    private let defaults: UserDefaults
    private let key: String
    private let legacyKey: String

    public init(
        defaults: UserDefaults = .standard,
        key: String = PromptHistoryStore.defaultsKey,
        legacyKey: String = PromptHistoryStore.legacyDefaultsKey
    ) {
        self.defaults = defaults
        self.key = key
        self.legacyKey = legacyKey
    }

    /// Matches the extension's text: CRLF becomes LF and outer whitespace goes.
    public static func normalized(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Distinct questions, newest first, at most three (legacy string helper).
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
        return entries
            .filter { entry in
                let key = entry.lowercased()
                return key != needle && key.hasPrefix(needle)
            }
            .prefix(limit)
            .map { $0 }
    }

    public static func key(for text: String) -> String {
        PromptHistoryRecord(text: text, createdAtMillis: 0, updatedAtMillis: 0).key
    }

    public static func currentMillis() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    private static func validMillis(_ value: Double, now: Double) -> Double {
        guard value.isFinite, value > 0 else { return 0 }
        return value > now + clockSkewMillis ? now : value
    }

    private static func sanitized(
        _ record: PromptHistoryRecord,
        nowMillis: Double
    ) -> PromptHistoryRecord? {
        let text = String(normalized(record.text).prefix(maxTextCharacters))
        guard !text.isEmpty else { return nil }
        var createdAt = validMillis(record.createdAtMillis, now: nowMillis)
        let updatedAt = validMillis(record.updatedAtMillis, now: nowMillis)
        guard updatedAt > 0 else { return nil }
        if createdAt <= 0 || createdAt > updatedAt {
            createdAt = updatedAt
        }
        if nowMillis - updatedAt > ttlMillis || updatedAt - nowMillis > clockSkewMillis {
            return nil
        }
        let summary = record.summary.flatMap { value -> PromptHistorySummary? in
            let createdAt = validMillis(value.createdAtMillis, now: nowMillis)
            let text = String(value.formattedText.prefix(maxSummaryCharacters))
            guard createdAt > 0, !text.isEmpty,
                  nowMillis - createdAt <= ttlMillis else { return nil }
            return PromptHistorySummary(
                blind: value.blind,
                formattedText: text,
                createdAtMillis: createdAt
            )
        }
        return PromptHistoryRecord(
            text: text,
            createdAtMillis: createdAt,
            updatedAtMillis: updatedAt,
            summary: summary
        )
    }

    /// Merges records by normalized question key. The newest update wins the
    /// text, the earliest creation time is kept, and the newest summary wins.
    public static func merged(
        local: [PromptHistoryRecord],
        remote: [PromptHistoryRecord],
        nowMillis: Double = PromptHistoryStore.currentMillis()
    ) -> [PromptHistoryRecord] {
        var byKey: [String: PromptHistoryRecord] = [:]
        for record in local + remote {
            guard let incoming = sanitized(record, nowMillis: nowMillis) else { continue }
            guard let existing = byKey[incoming.key] else {
                byKey[incoming.key] = incoming
                continue
            }
            let newer = incoming.updatedAtMillis > existing.updatedAtMillis ? incoming : existing
            let summary: PromptHistorySummary?
            switch (existing.summary, incoming.summary) {
            case let (old?, new?):
                summary = new.createdAtMillis > old.createdAtMillis ? new : old
            case let (old?, nil):
                summary = old
            case let (nil, new?):
                summary = new
            case (nil, nil):
                summary = nil
            }
            byKey[incoming.key] = PromptHistoryRecord(
                text: newer.text,
                createdAtMillis: min(existing.createdAtMillis, incoming.createdAtMillis),
                updatedAtMillis: max(existing.updatedAtMillis, incoming.updatedAtMillis),
                summary: summary
            )
        }
        return byKey.values.sorted { left, right in
            if left.updatedAtMillis == right.updatedAtMillis {
                return left.text.localizedCaseInsensitiveCompare(right.text) == .orderedAscending
            }
            return left.updatedAtMillis > right.updatedAtMillis
        }
    }

    private func decodeRecords(_ data: Data) -> [PromptHistoryRecord] {
        guard let history = try? JSONDecoder().decode(StoredHistory.self, from: data),
              history.version == Self.storedVersion else {
            return []
        }
        return history.records
    }

    private func legacyRecords(nowMillis: Double) -> [PromptHistoryRecord] {
        guard let legacy = defaults.stringArray(forKey: legacyKey) else { return [] }
        return legacy.enumerated().compactMap { index, text in
            let timestamp = nowMillis - Double(index)
            return PromptHistoryRecord(
                text: text,
                createdAtMillis: timestamp,
                updatedAtMillis: timestamp
            )
        }
    }

    public func loadRecords(nowMillis: Double = PromptHistoryStore.currentMillis()) -> [PromptHistoryRecord] {
        let stored = defaults.data(forKey: key)
        var records: [PromptHistoryRecord]
        if let stored {
            records = decodeRecords(stored)
        } else {
            records = legacyRecords(nowMillis: nowMillis)
            if !records.isEmpty {
                save(records)
                defaults.removeObject(forKey: legacyKey)
            }
        }
        return Self.merged(local: records, remote: [], nowMillis: nowMillis)
    }

    /// Question texts, newest first, for prefix suggestions.
    public func load() -> [String] {
        loadRecords().map(\.text)
    }

    @discardableResult
    public func record(_ text: String, nowMillis: Double = PromptHistoryStore.currentMillis()) -> [String] {
        let next = Self.normalized(text)
        guard !next.isEmpty else { return load() }
        let record = PromptHistoryRecord(
            text: next,
            createdAtMillis: nowMillis,
            updatedAtMillis: nowMillis
        )
        return merge([record], nowMillis: nowMillis).map(\.text)
    }

    @discardableResult
    public func merge(
        _ records: [PromptHistoryRecord],
        nowMillis: Double = PromptHistoryStore.currentMillis()
    ) -> [PromptHistoryRecord] {
        let merged = Self.merged(local: loadRecords(nowMillis: nowMillis), remote: records, nowMillis: nowMillis)
        save(merged)
        return merged
    }

    public func clear() {
        defaults.removeObject(forKey: key)
    }

    private func save(_ records: [PromptHistoryRecord]) {
        let history = StoredHistory(version: Self.storedVersion, records: records)
        guard let data = try? JSONEncoder().encode(history) else { return }
        defaults.set(data, forKey: key)
    }
}