import XCTest
@testable import PanelizeSearchCore

final class HistoryProtocolTests: XCTestCase {
    private func record(_ text: String, updated: Double = 1000) -> PromptHistoryRecord {
        PromptHistoryRecord(text: text, createdAtMillis: updated - 100, updatedAtMillis: updated)
    }

    func testSnapshotAssemblerAcceptsOutOfOrderAndDuplicateChunks() {
        var assembler = HistorySnapshotAssembler()
        XCTAssertNil(assembler.accept(snapshotId: "s1", index: 2, total: 3, records: [record("c")]))
        XCTAssertNil(assembler.accept(snapshotId: "s1", index: 0, total: 3, records: [record("a")]))
        // A duplicate chunk is ignored rather than duplicating rows.
        XCTAssertNil(assembler.accept(snapshotId: "s1", index: 0, total: 3, records: [record("a")]))
        let completed = assembler.accept(snapshotId: "s1", index: 1, total: 3, records: [record("b")])
        XCTAssertEqual(completed?.map(\.text), ["a", "b", "c"])
    }

    func testSnapshotAssemblerResetsOnANewSnapshotId() {
        var assembler = HistorySnapshotAssembler()
        XCTAssertNil(assembler.accept(snapshotId: "s1", index: 0, total: 2, records: [record("a")]))
        XCTAssertNil(assembler.accept(snapshotId: "s2", index: 1, total: 2, records: [record("b")]))
        let completed = assembler.accept(snapshotId: "s2", index: 0, total: 2, records: [record("c")])
        XCTAssertEqual(completed?.map(\.text), ["c", "b"])
    }

    func testSnapshotAssemblerRejectsInvalidChunks() {
        var assembler = HistorySnapshotAssembler()
        XCTAssertNil(assembler.accept(snapshotId: "", index: 0, total: 1, records: []))
        XCTAssertNil(assembler.accept(snapshotId: "s", index: -1, total: 1, records: []))
        XCTAssertNil(assembler.accept(snapshotId: "s", index: 0, total: 0, records: []))
        XCTAssertNil(assembler.accept(snapshotId: "s", index: 0, total: HistoryWire.maxChunks + 1, records: []))
        XCTAssertNil(assembler.accept(snapshotId: "s", index: 2, total: 1, records: []))
        // An empty but valid single-chunk snapshot completes immediately.
        XCTAssertEqual(assembler.accept(snapshotId: "empty", index: 0, total: 1, records: [])?.count, 0)
    }

    func testWireRecordRecomputesTheKeyAndIgnoresUnknownFields() {
        let parsed = HistoryWire.record(from: [
            "key": "stale key",
            "text": "  How Are\r\nyou?  ",
            "createdAt": 900,
            "updatedAt": 1000,
            "providerId": "chatgpt",
            "baseUrl": "https://secret"
        ])
        XCTAssertEqual(parsed?.key, "how are\nyou?")
        XCTAssertEqual(parsed?.text, "How Are\nyou?")
        XCTAssertNil(parsed?.summary)

        let invalid = HistoryWire.record(from: ["text": "  ", "createdAt": 1, "updatedAt": 2])
        XCTAssertNil(invalid)
    }

    func testWireRecordKeepsThePrecomputedSummaryText() {
        let parsed = HistoryWire.record(from: [
            "text": "Question",
            "createdAt": 900,
            "updatedAt": 1000,
            "summary": [
                "blind": true,
                "formattedText": "Anonymous model 1: yes",
                "createdAt": 950,
                "providerId": "chatgpt"
            ]
        ])
        XCTAssertEqual(parsed?.summary?.blind, true)
        XCTAssertEqual(parsed?.summary?.formattedText, "Anonymous model 1: yes")
        XCTAssertEqual(parsed?.summary?.createdAtMillis, 950)
        XCTAssertFalse(String(describing: parsed).contains("chatgpt"))
    }

    func testUpsertMessagesChunkAndOnlyCarryQuestionFields() {
        let records = (0..<51).map { index in
            PromptHistoryRecord(
                text: "question \(index)",
                createdAtMillis: 900,
                updatedAtMillis: 1000
            )
        }
        let messages = HistoryWire.upsertMessages(records: records, batchId: "batch-1")
        XCTAssertEqual(messages.count, 2)
        XCTAssertEqual(messages[0]["type"] as? String, "historyUpsert")
        XCTAssertEqual(messages[0]["batchId"] as? String, "batch-1")
        XCTAssertEqual(messages[0]["index"] as? Int, 0)
        XCTAssertEqual(messages[0]["total"] as? Int, 2)
        let firstRecords = messages[0]["records"] as? [[String: Any]]
        XCTAssertEqual(firstRecords?.count, 50)
        XCTAssertNotNil(firstRecords?.first?["text"])
        XCTAssertNil(firstRecords?.first?["summary"])
        XCTAssertEqual(messages[1]["index"] as? Int, 1)
        XCTAssertTrue(HistoryWire.upsertMessages(records: [], batchId: "b").isEmpty)
    }
}