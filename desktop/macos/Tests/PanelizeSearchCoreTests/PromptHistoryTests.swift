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
}
