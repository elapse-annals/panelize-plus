import XCTest
@testable import PanelizeSearchCore

final class PromptModeLocalizationTests: XCTestCase {
    func testLanguageFollowsTheFirstPreferredLanguage() {
        XCTAssertEqual(PromptTextLanguage.resolve(preferredLanguages: ["zh-Hans-CN"]), .zh)
        XCTAssertEqual(PromptTextLanguage.resolve(preferredLanguages: ["zh_TW"]), .zh)
        XCTAssertEqual(PromptTextLanguage.resolve(preferredLanguages: ["en-US"]), .en)
        XCTAssertEqual(PromptTextLanguage.resolve(preferredLanguages: ["ja-JP"]), .en)
        XCTAssertEqual(PromptTextLanguage.resolve(preferredLanguages: []), .en)
    }

    func testTextPairPicksTheRequestedLanguage() {
        let text = PromptModeText(zh: "中文", en: "English")
        XCTAssertEqual(text.text(in: .zh), "中文")
        XCTAssertEqual(text.text(in: .en), "English")
    }

    func testEveryModeHasTitlesAndHintsInBothLanguages() {
        for choice in PromptModeChoice.allCases {
            for language in PromptTextLanguage.allCases {
                XCTAssertFalse(
                    choice.title(in: language).isEmpty,
                    "Missing \(language.rawValue) title for \(choice.rawValue)"
                )
                XCTAssertFalse(
                    choice.hint(in: language).isEmpty,
                    "Missing \(language.rawValue) hint for \(choice.rawValue)"
                )
            }
        }

        XCTAssertEqual(PromptModeChoice.defaultMode.title(in: .zh), "默认")
        XCTAssertEqual(PromptModeChoice.defaultMode.title(in: .en), "Default")
        XCTAssertEqual(PromptModeChoice.auto.title(in: .zh), "自动")
        XCTAssertEqual(PromptModeChoice.auto.title(in: .en), "Auto")
        XCTAssertEqual(PromptModeChoice.concise.title(in: .zh), "精简")
        XCTAssertEqual(PromptModeChoice.concise.title(in: .en), "Concise")
        XCTAssertEqual(
            PromptModeChoice.defaultMode.hint(in: .zh),
            "不追加内容，各 AI 按自己的方式回答"
        )
        XCTAssertEqual(
            PromptModeChoice.auto.hint(in: .en),
            "Adds a mode only when the question has its trigger word, such as /study"
        )
        XCTAssertEqual(
            PromptModeChoice.concise.hint(in: .zh),
            "追加精简指令：只给结论和要点"
        )
    }

    func testBuiltInInstructionsExistInBothLanguages() {
        for choice in [PromptModeChoice.concise, .learning, .compete, .brainstorm, .deep] {
            XCTAssertFalse(
                PromptModePreview.instruction(for: choice, in: .zh)?.isEmpty ?? true,
                "Missing Chinese instruction for \(choice.rawValue)"
            )
            XCTAssertFalse(
                PromptModePreview.instruction(for: choice, in: .en)?.isEmpty ?? true,
                "Missing English instruction for \(choice.rawValue)"
            )
        }
        XCTAssertNil(PromptModePreview.instruction(for: .defaultMode, in: .zh))
        XCTAssertNil(PromptModePreview.instruction(for: .auto, in: .en))
    }

    func testWireValuesAreUnchanged() {
        XCTAssertEqual(PromptModeChoice.allCases.map(\.rawValue), [
            "default", "auto", "concise", "learning", "compete", "brainstorm", "deep"
        ])
    }
}