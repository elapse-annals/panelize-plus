import XCTest
@testable import PanelizeSearchCore

final class PromptModePreviewTests: XCTestCase {
    private let languages: [PromptTextLanguage] = [.zh, .en]

    func testDefaultHidesPreview() {
        for language in languages {
            XCTAssertNil(PromptModePreview.text(for: .defaultMode, language: language))
            XCTAssertNil(PromptModePreview.text(for: .defaultMode, input: "/study", language: language))
        }
    }

    func testBuiltInPreviewsAreSingleLineAndDistinct() {
        let modes: [PromptModeChoice] = [.concise, .learning, .compete, .brainstorm, .deep]
        for language in languages {
            var seen = Set<String>()
            for mode in modes {
                let text = PromptModePreview.text(for: mode, input: "/study", language: language)
                let unwrapped = text ?? ""
                XCTAssertFalse(unwrapped.isEmpty, "\(mode.rawValue) should have a preview")
                XCTAssertFalse(unwrapped.contains("\n"), "\(mode.rawValue) preview must be one line")
                XCTAssertEqual(unwrapped, unwrapped.trimmingCharacters(in: .whitespacesAndNewlines))
                XCTAssertTrue(
                    seen.insert(unwrapped).inserted,
                    "\(mode.rawValue) preview should be distinct in \(language.rawValue)"
                )
            }
        }

        XCTAssertEqual(
            PromptModePreview.text(for: .concise, language: .zh),
            "请尽量简洁：直接给出结论和关键要点，省略铺垫、客套和重复。"
        )
        XCTAssertEqual(
            PromptModePreview.text(for: .learning, language: .zh),
            "请以教学方式回答：先给出核心结论，再循序渐进解释原理，配合例子，并在最后提出 1–2 个检验理解的问题。"
        )
        XCTAssertEqual(
            PromptModePreview.text(for: .brainstorm, language: .zh),
            "请进行头脑风暴：给出多个不同角度、尽量多样甚至大胆的思路，简要说明各自优缺点，不急于下结论。"
        )
        let deep = PromptModePreview.text(for: .deep, language: .zh) ?? ""
        XCTAssertTrue(deep.hasPrefix("请以严谨、客观、具有批判性思维的专家身份分析问题。"))
        XCTAssertTrue(deep.contains("四、最终目标"))
        XCTAssertTrue(deep.hasSuffix("并给出最合理、可执行的建议。"))
        let compete = PromptModePreview.text(for: .compete, language: .zh) ?? ""
        XCTAssertTrue(compete.hasPrefix("请充当上面这条消息的对抗性但公正的同行审稿人"))
        XCTAssertTrue(compete.contains("最后向我提出 3–5 个尖锐的澄清问题"))
    }

    func testEnglishPreviewsUseTheExtensionEnglishText() {
        XCTAssertEqual(
            PromptModePreview.text(for: .concise, language: .en),
            "Be as concise as possible: give the conclusion and the key points only, and skip preamble, pleasantries and repetition."
        )
        XCTAssertEqual(
            PromptModePreview.text(for: .learning, language: .en),
            "Answer as a teacher: give the core conclusion first, then explain the reasoning step by step with examples, and finish with 1–2 questions that check my understanding."
        )
        let deep = PromptModePreview.text(for: .deep, language: .en) ?? ""
        XCTAssertTrue(deep.hasPrefix("Act as a rigorous, objective, and critically minded expert"))
        XCTAssertTrue(deep.contains("4. Ultimate Objective"))
        XCTAssertTrue(deep.hasSuffix("deliver the most reasonable and actionable recommendations."))
    }

    func testAutoWithoutTriggersShowsLegend() {
        for language in languages {
            XCTAssertEqual(
                PromptModePreview.text(for: .auto, language: language),
                PromptModePreview.triggerLegend(in: language)
            )
            XCTAssertEqual(
                PromptModePreview.text(
                    for: .auto,
                    input: "解释一下量子计算",
                    language: language
                ),
                PromptModePreview.triggerLegend(in: language)
            )
        }

        XCTAssertEqual(
            PromptModePreview.triggerLegend(in: .en),
            "/brief Concise · /study Learning · /challenge Challenge · /brainstorm Brainstorm · /think Deep thinking"
        )
    }

    func testAutoMatchesTriggersCaseInsensitively() {
        for language in languages {
            let learning = PromptModePreview.text(for: .learning, language: language)
            XCTAssertEqual(PromptModePreview.text(for: .auto, input: "/study 解释", language: language), learning)
            XCTAssertEqual(PromptModePreview.text(for: .auto, input: "/STUDY", language: language), learning)
            XCTAssertEqual(PromptModePreview.text(for: .auto, input: "解释一下 /learn", language: language), learning)
        }
    }

    func testAutoCombinesMatchedModesInMenuOrder() {
        for language in languages {
            let concise = PromptModePreview.text(for: .concise, language: language) ?? ""
            let learning = PromptModePreview.text(for: .learning, language: language) ?? ""
            let compete = PromptModePreview.text(for: .compete, language: language) ?? ""
            let deep = PromptModePreview.text(for: .deep, language: language) ?? ""

            XCTAssertEqual(
                PromptModePreview.text(for: .auto, input: "/study /brief", language: language),
                "\(concise) \(learning)"
            )
            XCTAssertEqual(
                PromptModePreview.text(for: .auto, input: "/deep /challenge /study", language: language),
                "\(learning) \(compete) \(deep)"
            )
            XCTAssertEqual(
                PromptModePreview.text(for: .auto, input: "/study /learn", language: language),
                learning,
                "one mode appears once even when several of its triggers match"
            )
        }
    }

    func testAutoIgnoresTriggersInsidePathsAndWords() {
        for language in languages {
            for input in ["a/study", "/studying", "https://x/study", "/study.md", "/study2", "path/study"] {
                XCTAssertEqual(
                    PromptModePreview.text(for: .auto, input: input, language: language),
                    PromptModePreview.triggerLegend(in: language),
                    input
                )
            }

            let concise = PromptModePreview.text(for: .concise, language: language) ?? ""
            XCTAssertEqual(
                PromptModePreview.text(for: .auto, input: "a/study and /brief", language: language),
                concise,
                "only the whole word matches"
            )
        }
    }
}