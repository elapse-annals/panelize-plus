import XCTest
@testable import PanelizeSearchCore

final class PromptTriggerCompletionTests: XCTestCase {
    private func complete(_ text: String, caret: Int? = nil) -> PromptTriggerCompletion? {
        PromptModePreview.completion(in: text, caret: caret ?? (text as NSString).length)
    }

    func testCompletesTriggerAtLineEnd() {
        let completion = complete("/st")

        XCTAssertEqual(completion?.trigger, "/study")
        XCTAssertEqual(completion?.rest, "udy")
        XCTAssertEqual(completion?.mode, .learning)
        XCTAssertEqual(completion?.range, NSRange(location: 0, length: 3))
        XCTAssertEqual(completion?.typed, "/st")
        XCTAssertEqual(completion?.mode.title, "学习")
    }

    func testCompletionIgnoresCase() {
        let completion = complete("/ST")

        XCTAssertEqual(completion?.trigger, "/study")
        XCTAssertEqual(completion?.rest, "udy")
        XCTAssertEqual(completion?.range, NSRange(location: 0, length: 3))
        XCTAssertEqual(completion?.typed, "/ST")
    }

    func testUsesFirstTriggerInMenuOrder() {
        XCTAssertEqual(complete("/b")?.trigger, "/brief")
        XCTAssertEqual(complete("/c")?.trigger, "/concise")
        XCTAssertEqual(complete("/ch")?.trigger, "/challenge")
        XCTAssertEqual(complete("/i")?.trigger, "/idea")
        XCTAssertEqual(complete("/l")?.trigger, "/learn")
        XCTAssertEqual(complete("/s")?.trigger, "/study")
        XCTAssertEqual(complete("/t")?.trigger, "/think")
        XCTAssertEqual(complete("/d")?.trigger, "/deep")
    }

    func testRequiresCaretAtLineEnd() {
        XCTAssertNil(complete("/st", caret: 2))
        XCTAssertNil(complete("/st more", caret: 3))
        XCTAssertNotNil(complete("/st\nmore", caret: 3))
        XCTAssertNil(complete("/st\n", caret: 4))
        XCTAssertNil(complete("/st", caret: -1))
        XCTAssertNil(complete("/st", caret: 99))
        XCTAssertNil(complete("", caret: 0))
    }

    func testIgnoresTriggersInsidePathsAndWords() {
        for input in ["a/st", "path/study", "https://x/st", "//st", "x:/st"] {
            XCTAssertNil(complete(input), input)
        }

        XCTAssertEqual(complete("中文/st")?.trigger, "/study")
        XCTAssertEqual(complete("，/st")?.trigger, "/study")
        XCTAssertEqual(complete(" /st")?.trigger, "/study")
    }

    func testUsesUTF16Offsets() {
        XCTAssertEqual(complete("解释 /st")?.range, NSRange(location: 3, length: 3))
        XCTAssertEqual(complete("😀/st")?.range, NSRange(location: 2, length: 3))
        XCTAssertEqual(complete("e\u{301}/st")?.range, NSRange(location: 2, length: 3))
    }

    func testFullAndUnknownTriggersDoNotComplete() {
        for input in ["/study", "/studying", "/xyz", "/", "/st "] {
            XCTAssertNil(complete(input), input)
        }
    }
}