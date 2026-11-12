import Foundation

/// One chunk of a history snapshot or incremental update.
public struct HistoryBatch: Equatable {
    public let batchId: String
    public let index: Int
    public let total: Int
    public let records: [PromptHistoryRecord]

    public init(batchId: String, index: Int, total: Int, records: [PromptHistoryRecord]) {
        self.batchId = batchId
        self.index = index
        self.total = total
        self.records = records
    }
}

/// Reassembles chunked snapshots that may arrive out of order or twice.
public struct HistorySnapshotAssembler {
    private var snapshotId: String?
    private var total = 0
    private var chunks: [Int: [PromptHistoryRecord]] = [:]

    public init() {}

    /// Returns the complete record list once every chunk arrived; otherwise nil.
    public mutating func accept(
        snapshotId: String,
        index: Int,
        total: Int,
        records: [PromptHistoryRecord]
    ) -> [PromptHistoryRecord]? {
        guard !snapshotId.isEmpty,
              snapshotId.count <= HistoryWire.maxBatchIdLength,
              index >= 0,
              index < total,
              total >= 1,
              total <= HistoryWire.maxChunks else {
            return nil
        }
        if self.snapshotId != snapshotId || self.total != total {
            self.snapshotId = snapshotId
            self.total = total
            chunks.removeAll()
        }
        if chunks[index] == nil {
            chunks[index] = records
        }
        guard chunks.count == total else { return nil }
        let ordered = (0..<total).flatMap { chunks[$0] ?? [] }
        self.snapshotId = nil
        self.total = 0
        chunks.removeAll()
        return ordered
    }
}

public struct NewChatOutcome: Equatable {
    public let requestId: String
    public let ok: Bool
    public let ready: Int
    public let total: Int
    public let reason: String

    public init(requestId: String, ok: Bool, ready: Int = 0, total: Int = 0, reason: String = "") {
        self.requestId = requestId
        self.ok = ok
        self.ready = ready
        self.total = total
        self.reason = reason
    }
}

/// Wire-format helpers shared by the app and the native host.
public enum HistoryWire {
    public static let maxRecordsPerChunk = 50
    public static let maxTextCharacters = 20_000
    public static let maxSummaryCharacters = 150_000
    public static let maxBatchIdLength = 100
    public static let maxChunks = 128
    public static let maxReasonLength = 120
    public static let chunkBytes = 60 * 1024

    private static func millis(_ value: Any?) -> Double {
        if let number = value as? NSNumber {
            return number.doubleValue
        }
        if let double = value as? Double {
            return double
        }
        if let int = value as? Int {
            return Double(int)
        }
        return 0
    }

    /// Parses one synced record; the key is always recomputed from the text.
    public static func record(from message: [String: Any]) -> PromptHistoryRecord? {
        guard let rawText = message["text"] as? String else { return nil }
        let text = String(
            PromptHistoryStore.normalized(rawText).prefix(maxTextCharacters)
        )
        guard !text.isEmpty else { return nil }
        let createdAt = millis(message["createdAt"])
        let updatedAt = millis(message["updatedAt"])
        guard createdAt > 0, updatedAt > 0 else { return nil }

        var summary: PromptHistorySummary?
        if let value = message["summary"] as? [String: Any] {
            let formattedText = String(
                (value["formattedText"] as? String ?? "").prefix(maxSummaryCharacters)
            )
            let summaryCreatedAt = millis(value["createdAt"])
            if !formattedText.isEmpty, summaryCreatedAt > 0 {
                summary = PromptHistorySummary(
                    blind: value["blind"] as? Bool ?? false,
                    formattedText: formattedText,
                    createdAtMillis: summaryCreatedAt
                )
            }
        }

        return PromptHistoryRecord(
            text: text,
            createdAtMillis: createdAt,
            updatedAtMillis: updatedAt,
            summary: summary
        )
    }

    /// Parses a record array, dropping malformed entries.
    public static func records(from value: Any?) -> [PromptHistoryRecord]? {
        guard let array = value as? [Any], array.count <= maxRecordsPerChunk else {
            return nil
        }
        return array.compactMap { item in
            guard let message = item as? [String: Any] else { return nil }
            return record(from: message)
        }
    }

    /// The question fields sent back to the extension. Summaries originate in
    /// the extension, so the desktop never pushes one.
    public static func questionMessage(_ record: PromptHistoryRecord) -> [String: Any] {
        [
            "key": record.key,
            "text": String(record.text.prefix(maxTextCharacters)),
            "createdAt": record.createdAtMillis,
            "updatedAt": record.updatedAtMillis
        ]
    }

    /// Splits local questions into protocol-sized upsert messages.
    public static func upsertMessages(
        records: [PromptHistoryRecord],
        batchId: String
    ) -> [[String: Any]] {
        var chunks: [[[String: Any]]] = []
        var current: [[String: Any]] = []
        var currentBytes = 2

        for record in records {
            let message = questionMessage(record)
            let bytes = (try? JSONSerialization.data(withJSONObject: message).count) ?? 0
            if !current.isEmpty,
               current.count >= maxRecordsPerChunk || currentBytes + bytes > chunkBytes {
                chunks.append(current)
                current = []
                currentBytes = 2
            }
            current.append(message)
            currentBytes += bytes + 1
        }
        if !current.isEmpty {
            chunks.append(current)
        }
        let bounded = chunks.prefix(maxChunks)
        let total = bounded.count
        guard total > 0 else { return [] }
        return bounded.enumerated().map { index, chunk in
            [
                "protocol": BridgeProtocol.version,
                "type": "historyUpsert",
                "batchId": String(batchId.prefix(maxBatchIdLength)),
                "index": index,
                "total": total,
                "records": chunk
            ]
        }
    }
}