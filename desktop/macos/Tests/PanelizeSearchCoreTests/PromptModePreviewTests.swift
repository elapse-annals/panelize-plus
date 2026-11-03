import XCTest
@testable import PanelizeSearchCore

final class PromptModePreviewTests: XCTestCase {
    func testDefaultHidesPreview() {
        XCTAssertNil(PromptModePreview.text(for: .defaultMode))
        XCTAssertNil(PromptModePreview.text(for: .defaultMode, input: "/study"))
    }

    func testBuiltInPreviewsAreSingleLineAndDistinct() {
        let modes: [PromptModeChoice] = [.concise, .learning, .compete, .brainstorm, .deep]
        var seen = Set<String>()
        for mode in modes {
            let text = PromptModePreview.text(for: mode, input: "/study")
            let unwrapped = text ?? ""
            XCTAssertFalse(unwrapped.isEmpty, "\(mode.rawValue) should have a preview")
            XCTAssertFalse(unwrapped.contains("\n"), "\(mode.rawValue) preview must be one line")
            XCTAssertEqual(unwrapped, unwrapped.trimmingCharacters(in: .whitespacesAndNewlines))
            XCTAssertTrue(seen.insert(unwrapped).inserted, "\(mode.rawValue) preview should be distinct")
        }

        XCTAssertEqual(
            PromptModePreview.text(for: .concise),
            "请尽量简洁：直接给出结论和关键要点，省略铺垫、客套和重复。"
        )
        XCTAssertEqual(
            PromptModePreview.text(for: .learning),
            "请以教学方式回答：先给出核心结论，再循序渐进解释原理，配合例子，并在最后提出 1–2 个检验理解的问题。"
        )
        XCTAssertEqual(
            PromptModePreview.text(for: .brainstorm),
            "请进行头脑风暴：给出多个不同角度、尽量多样甚至大胆的思路，简要说明各自优缺点，不急于下结论。"
        )
        XCTAssertEqual(
            PromptModePreview.text(for: .deep),
            "请逐步思考拆解问题，识别假设，分析根因，比较方案，反向验证，并在给出最终结论前，详细列出你的推导步骤，说明不确定性。"
        )
        let compete = PromptModePreview.text(for: .compete) ?? ""
        XCTAssertTrue(compete.hasPrefix("请充当上面这条消息的对抗性但公正的同行审稿人"))
        XCTAssertTrue(compete.contains("最后向我提出 3–5 个尖锐的澄清问题"))
    }

    func testAutoWithoutTriggersShowsLegend() {
        XCTAssertEqual(PromptModePreview.text(for: .auto), PromptModePreview.autoTriggerLegend)
        XCTAssertEqual(
            PromptModePreview.text(for: .auto, input: "解释一下量子计算"),
            PromptModePreview.autoTriggerLegend
        )
    }

    func testAutoMatchesTriggersCaseInsensitively() {
        let learning = PromptModePreview.text(for: .learning)
        XCTAssertEqual(PromptModePreview.text(for: .auto, input: "/study 解释"), learning)
        XCTAssertEqual(PromptModePreview.text(for: .auto, input: "/STUDY"), learning)
        XCTAssertEqual(PromptModePreview.text(for: .auto, input: "解释一下 /learn"), learning)
    }

    func testAutoCombinesMatchedModesInMenuOrder() {
        let concise = PromptModePreview.text(for: .concise) ?? ""
        let learning = PromptModePreview.text(for: .learning) ?? ""
        let compete = PromptModePreview.text(for: .compete) ?? ""
        let deep = PromptModePreview.text(for: .deep) ?? ""

        XCTAssertEqual(
            PromptModePreview.text(for: .auto, input: "/study /brief"),
            "\(concise) \(learning)"
        )
        XCTAssertEqual(
            PromptModePreview.text(for: .auto, input: "/deep /challenge /study"),
            "\(learning) \(compete) \(deep)"
        )
        XCTAssertEqual(
            PromptModePreview.text(for: .auto, input: "/study /learn"),
            learning,
            "one mode appears once even when several of its triggers match"
        )
    }

    func testAutoIgnoresTriggersInsidePathsAndWords() {
        for input in ["a/study", "/studying", "https://x/study", "/study.md", "/study2", "path/study"] {
            XCTAssertEqual(
                PromptModePreview.text(for: .auto, input: input),
                PromptModePreview.autoTriggerLegend,
                input
            )
        }

        let concise = PromptModePreview.text(for: .concise) ?? ""
        XCTAssertEqual(
            PromptModePreview.text(for: .auto, input: "a/study and /brief"),
            concise,
            "only the whole word matches"
        )
    }
}