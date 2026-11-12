import XCTest
@testable import PanelizeSearchCore

final class PromptHistoryTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "PromptHistoryTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testNormalizedTrimsOuterWhitespaceAndNormalizesLineEndings() {
        XCTAssertEqual(PromptHistoryStore.normalized("  How are\r\nthey?\r  "), "How are\nthey?")
        XCTAssertEqual(PromptHistoryStore.normalized("   "), "")
    }

    func testReadingKeepsDistinctQuestionsNewestFirstAtMostThree() {
        XCTAssertEqual(
            PromptHistoryStore.reading(["one", "ONE", "two", "three", "four"]),
            ["one", "two", "three"]
        )
        XCTAssertEqual(PromptHistoryStore.reading(nil), [])
    }

    func testAddingMovesARepeatedQuestionToTheFront() {
        var entries = PromptHistoryStore.adding("What is AI?", to: [])
        entries = PromptHistoryStore.adding("How does it work?", to: entries)
        entries = PromptHistoryStore.adding("what is ai?", to: entries)
        XCTAssertEqual(entries, ["what is ai?", "How does it work?"])
    }

    func testAddingDropsTheOldestAfterThree() {
        let entries = ["one", "two", "three", "four"]
            .reduce(into: [String]()) { result, text in
                result = PromptHistoryStore.adding(text, to: result)
            }
        XCTAssertEqual(entries, ["four", "three", "two"])
    }

    func testMatchesPrefixIgnoringCaseAndWhitespace() {
        let entries = ["How do these compare?", "How does it work?", "什么是人工智能？"]
        XCTAssertEqual(
            PromptHistoryStore.matches(entries, prefix: "  how d"),
            ["How do these compare?", "How does it work?"]
        )
        XCTAssertEqual(PromptHistoryStore.matches(entries, prefix: "什么是"), ["什么是人工智能？"])
        XCTAssertEqual(PromptHistoryStore.matches(entries, prefix: "   "), [])
        XCTAssertEqual(PromptHistoryStore.matches(entries, prefix: "why"), [])
    }

    func testMatchesOmitsAnExactDraft() {
        let entries = ["How does it work?"]
        XCTAssertEqual(PromptHistoryStore.matches(entries, prefix: "How does it work?"), [])
        XCTAssertEqual(PromptHistoryStore.matches(entries, prefix: "how does it work?"), [])
    }

    func testStorePersistsAndReadsBackFromInjectedDefaults() {
        let store = PromptHistoryStore(defaults: defaults, key: "history")
        XCTAssertEqual(store.load(), [])
        XCTAssertEqual(store.record("first"), ["first"])
        XCTAssertEqual(store.record("second"), ["second", "first"])
        XCTAssertEqual(store.load(), ["second", "first"])
        store.clear()
        XCTAssertEqual(store.load(), [])
    }

    func testStoreIgnoresEmptyQuestions() {
        let store = PromptHistoryStore(defaults: defaults, key: "history")
        store.record("kept")
        XCTAssertEqual(store.record("   "), ["kept"])
    }

    func testLoadRecordsMigratesLegacyStringsOnce() {
        let now: Double = 1_800_000_000_000
        defaults.set(["one", "two"], forKey: "legacy")
        let store = PromptHistoryStore(defaults: defaults, key: "history", legacyKey: "legacy")

        let records = store.loadRecords(nowMillis: now)
        XCTAssertEqual(records.map(\.text), ["one", "two"])
        XCTAssertEqual(records[0].createdAtMillis, now)
        XCTAssertEqual(records[1].createdAtMillis, now - 1)
        XCTAssertNotNil(defaults.data(forKey: "history"))
        XCTAssertNil(defaults.stringArray(forKey: "legacy"))
    }

    func testRecordsExpireAfterThreeDaysButSurviveTheBoundary() {
        let now: Double = 1_800_000_000_000
        let store = PromptHistoryStore(defaults: defaults, key: "history")
        store.merge([
            PromptHistoryRecord(text: "edge", createdAtMillis: now - PromptHistoryStore.ttlMillis, updatedAtMillis: now - PromptHistoryStore.ttlMillis)
        ], nowMillis: now)
        XCTAssertEqual(store.loadRecords(nowMillis: now).map(\.text), ["edge"])
        XCTAssertTrue(store.loadRecords(nowMillis: now + 1).isEmpty)
    }

    func testMergeKeepsEarliestCreationNewestTextAndNewestSummary() {
        let now: Double = 1_800_000_000_000
        let local = PromptHistoryRecord(
            text: "First copy",
            createdAtMillis: now - 5000,
            updatedAtMillis: now - 4000,
            summary: PromptHistorySummary(blind: false, formattedText: "old", createdAtMillis: now - 4000)
        )
        let remote = PromptHistoryRecord(
            text: "first COPY",
            createdAtMillis: now - 3000,
            updatedAtMillis: now - 1000,
            summary: PromptHistorySummary(blind: true, formattedText: "new", createdAtMillis: now - 900)
        )
        let merged = PromptHistoryStore.merged(local: [local], remote: [remote], nowMillis: now)
        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged[0].text, "first COPY")
        XCTAssertEqual(merged[0].createdAtMillis, now - 5000)
        XCTAssertEqual(merged[0].updatedAtMillis, now - 1000)
        XCTAssertEqual(merged[0].summary?.formattedText, "new")
        XCTAssertEqual(merged[0].summary?.blind, true)
    }

    func testRecordsAndSummariesSurviveAJSONRoundTrip() {
        let now: Double = 1_800_000_000_000
        let store = PromptHistoryStore(defaults: defaults, key: "history")
        store.merge([
            PromptHistoryRecord(
                text: "Question",
                createdAtMillis: now,
                updatedAtMillis: now,
                summary: PromptHistorySummary(
                    blind: true,
                    formattedText: "Anonymous model 1: yes",
                    createdAtMillis: now
                )
            )
        ], nowMillis: now)

        let reloaded = PromptHistoryStore(defaults: defaults, key: "history")
            .loadRecords(nowMillis: now)
        XCTAssertEqual(reloaded.count, 1)
        XCTAssertEqual(reloaded[0].text, "Question")
        XCTAssertEqual(reloaded[0].summary?.blind, true)
        XCTAssertEqual(reloaded[0].summary?.formattedText, "Anonymous model 1: yes")
    }

    func testSuggestionsRemainLimitedToThreeEvenWithLongHistory() {
        let now: Double = 1_800_000_000_000
        let store = PromptHistoryStore(defaults: defaults, key: "history")
        store.merge((0..<6).map { index in
            PromptHistoryRecord(
                text: "one question \(index)",
                createdAtMillis: now - Double(index * 1000),
                updatedAtMillis: now - Double(index * 1000)
            )
        }, nowMillis: now)

        XCTAssertEqual(store.loadRecords(nowMillis: now).count, 6)
        XCTAssertEqual(
            PromptHistoryStore.matches(store.load(), prefix: "one").count,
            PromptHistoryStore.maxEntries
        )
    }

    func testCorruptStoredDataLoadsAsEmptyAndSummaryTextIsBounded() {
        defaults.set(Data("not json".utf8), forKey: "history")
        let store = PromptHistoryStore(defaults: defaults, key: "history")
        XCTAssertTrue(store.loadRecords().isEmpty)

        let now: Double = 1_800_000_000_000
        let longSummary = String(repeating: "a", count: PromptHistoryStore.maxSummaryCharacters + 20)
        let merged = PromptHistoryStore.merged(local: [], remote: [
            PromptHistoryRecord(
                text: "long",
                createdAtMillis: now,
                updatedAtMillis: now,
                summary: PromptHistorySummary(blind: false, formattedText: longSummary, createdAtMillis: now)
            )
        ], nowMillis: now)
        XCTAssertEqual(merged[0].summary?.formattedText.count, PromptHistoryStore.maxSummaryCharacters)
    }
}
