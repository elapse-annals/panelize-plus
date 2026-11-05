import XCTest
@testable import PanelizeSearchCore

final class SendProgressTextTests: XCTestCase {
    private func progress(
        stage: SendProgressStage,
        ready: Int = 0,
        total: Int = 0,
        pendingCount: Int = 0,
        timedOutCount: Int = 0,
        pendingNames: [String] = [],
        timedOutNames: [String] = [],
        blind: Bool = false
    ) -> SendProgress {
        SendProgress(
            requestId: "request-1",
            stage: stage,
            ready: ready,
            total: total,
            pendingCount: pendingCount,
            timedOutCount: timedOutCount,
            pendingNames: pendingNames,
            timedOutNames: timedOutNames,
            blind: blind
        )
    }

    func testStatusShowsReadinessCountsAndNeverInventsATotal() {
        XCTAssertEqual(SendProgressText.status(for: progress(stage: .opening)), "正在打开 AI 面板…")
        XCTAssertEqual(
            SendProgressText.status(for: progress(stage: .preparing, ready: 3, total: 5)),
            "AI 准备中：3/5"
        )
        XCTAssertEqual(
            SendProgressText.status(for: progress(stage: .preparing, ready: 2)),
            "正在准备 AI…"
        )
        XCTAssertEqual(SendProgressText.status(for: progress(stage: .sending)), "正在发送…")
    }

    func testPreviewOnlyNamesWaitingAIsWhileSending() {
        let preparing = progress(stage: .preparing, ready: 1, total: 3, pendingNames: ["Claude"])
        XCTAssertNil(SendProgressText.preview(for: preparing))

        let sending = progress(
            stage: .sending,
            ready: 3,
            total: 5,
            pendingCount: 2,
            pendingNames: ["Claude", "Gemini"]
        )
        XCTAssertEqual(SendProgressText.preview(for: sending), "等待：Claude、Gemini")
        XCTAssertEqual(SendProgressText.fullPreview(for: sending), "等待：Claude、Gemini")
    }

    func testLongNameListsAreShortenedButKeepTheFullText() {
        let sending = progress(
            stage: .sending,
            ready: 2,
            total: 6,
            pendingCount: 4,
            pendingNames: ["Claude", "Gemini", "ChatGPT", "DeepSeek"]
        )
        XCTAssertEqual(SendProgressText.preview(for: sending), "等待：Claude、Gemini 等 4 个")
        XCTAssertEqual(
            SendProgressText.fullPreview(for: sending),
            "等待：Claude、Gemini、ChatGPT、DeepSeek"
        )
    }

    func testTimedOutPanelsAreNamedOnlyWithoutPendingOnes() {
        let timedOut = progress(
            stage: .sending,
            ready: 3,
            total: 5,
            timedOutCount: 2,
            timedOutNames: ["Kimi", "Qwen"]
        )
        XCTAssertEqual(SendProgressText.preview(for: timedOut), "未就绪：Kimi、Qwen")

        let pendingWins = progress(
            stage: .sending,
            ready: 3,
            total: 5,
            pendingCount: 1,
            timedOutCount: 1,
            pendingNames: ["Gemini"],
            timedOutNames: ["Kimi"]
        )
        XCTAssertEqual(SendProgressText.preview(for: pendingWins), "等待：Gemini")
    }

    func testBlindModeShowsCountsOnly() {
        let sending = progress(
            stage: .sending,
            ready: 3,
            total: 5,
            pendingCount: 2,
            pendingNames: [],
            blind: true
        )
        XCTAssertEqual(SendProgressText.preview(for: sending), "等待：2 个 AI")

        let timedOut = progress(
            stage: .sending,
            ready: 4,
            total: 5,
            timedOutCount: 1,
            blind: true
        )
        XCTAssertEqual(SendProgressText.preview(for: timedOut), "未就绪：1 个 AI")
        XCTAssertNil(SendProgressText.preview(for: progress(
            stage: .sending,
            ready: 5,
            total: 5,
            blind: true
        )))
    }

    func testSignatureIgnoresRepeatsAndFollowsNames() {
        let first = progress(stage: .preparing, ready: 1, total: 5, pendingNames: ["Claude"])
        let repeatValue = progress(stage: .preparing, ready: 1, total: 5, pendingNames: ["Claude"])
        let changed = progress(stage: .preparing, ready: 1, total: 5, pendingNames: ["Gemini"])
        XCTAssertEqual(first.signature, repeatValue.signature)
        XCTAssertNotEqual(first.signature, changed.signature)
    }
}