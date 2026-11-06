import AppKit
import PanelizeSearchCore
import XCTest
@testable import PanelizeSearchApp

private final class FakeSendBridge: GlobalSendBridge {
    var connectedBrowserBundleIdentifier: String? = "com.example.Browser"
    private var updateHandler: ((BridgeSendUpdate) -> Void)?
    private(set) var submitted: [(text: String, mode: PromptModeChoice)] = []

    func sendPrompt(
        _ text: String,
        promptMode: PromptModeChoice,
        update: @escaping (BridgeSendUpdate) -> Void
    ) -> Bool {
        submitted.append((text, promptMode))
        updateHandler = update
        return true
    }

    func emit(_ update: BridgeSendUpdate) {
        updateHandler?(update)
    }
}

final class SearchPanelControllerTests: XCTestCase {
    private var bridge: FakeSendBridge!
    private var controller: SearchPanelController!
    private var activations: [String] = []

    override func setUp() {
        super.setUp()
        _ = NSApplication.shared
        bridge = FakeSendBridge()
        activations = []
        controller = SearchPanelController(
            bridge: bridge,
            activateBrowser: { [weak self] identifier in
                self?.activations.append(identifier)
                return true
            }
        )
    }

    override func tearDown() {
        controller?.hide()
        controller?.window?.close()
        controller = nil
        bridge = nil
        super.tearDown()
    }

    private func requireWindowServer() throws {
        try XCTSkipUnless(NSScreen.main != nil, "Needs a window server for visibility checks")
    }

    private func progress(
        _ stage: SendProgressStage,
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

    private func waitUntil(
        timeout: TimeInterval = 2,
        _ condition: () -> Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
        return condition()
    }

    private func pump(_ interval: TimeInterval = 0.2) {
        RunLoop.current.run(until: Date().addingTimeInterval(interval))
    }

    private func beginSend(_ text: String = "Explain closures") {
        controller.content.textView.string = text
        controller.submit()
        XCTAssertEqual(bridge.submitted.count, 1)
    }

    func testProgressOpensBrowserOnceKeepsHiddenPanelClosedAndRestoresWhenShown() throws {
        try requireWindowServer()
        controller.show()
        beginSend()

        bridge.emit(.accepted)
        XCTAssertEqual(activations, [], "accepted alone must not bring the browser forward")

        bridge.emit(.progress(progress(.opening)))
        XCTAssertEqual(activations, ["com.example.Browser"])

        let preparing = progress(
            .preparing,
            ready: 3,
            total: 5,
            pendingCount: 2,
            pendingNames: ["Claude", "Gemini"]
        )
        bridge.emit(.progress(preparing))
        XCTAssertEqual(controller.content.statusLabel.stringValue, "AI 准备中：3/5")

        // A repeated tick and a stage regression change nothing.
        bridge.emit(.progress(preparing))
        bridge.emit(.progress(progress(.opening)))
        XCTAssertEqual(controller.content.statusLabel.stringValue, "AI 准备中：3/5")
        XCTAssertEqual(activations.count, 1, "the browser is raised once per request")

        // Hiding the composer must not be undone by later progress.
        controller.hide()
        XCTAssertTrue(waitUntil { self.controller.window?.isVisible == false })

        let sending = progress(
            .sending,
            ready: 3,
            total: 5,
            pendingCount: 2,
            pendingNames: ["Claude", "Gemini"]
        )
        bridge.emit(.progress(sending))
        XCTAssertFalse(controller.window?.isVisible ?? true)
        XCTAssertEqual(controller.latestProgress?.stage, .sending)

        // Reopening shows the latest progress instead of the mode preview.
        controller.show()
        XCTAssertEqual(controller.content.statusLabel.stringValue, "正在发送…")
        XCTAssertEqual(controller.content.previewLabel.stringValue, "等待：Claude、Gemini")
        XCTAssertEqual(
            controller.content.modeHintLabel.stringValue,
            PromptModeChoice.auto.hint(in: .current),
            "the mode hint stays visible while progress replaces the preview"
        )
        XCTAssertEqual(activations.count, 1)

        bridge.emit(.succeeded(SendOutcome(requestId: "request-1", ok: true, sent: 3, total: 5)))
        XCTAssertEqual(activations.count, 1, "success does not raise the browser a second time")
        XCTAssertFalse(controller.isSending)
        XCTAssertTrue(controller.isShowingSendResult)
        XCTAssertTrue(controller.content.statusLabel.stringValue.contains("3/5"))
        XCTAssertNotEqual(controller.content.previewLabel.stringValue, "等待：Claude、Gemini")
    }

    func testFocusLossDuringSendAndResultKeepsThePanelButOutsideClickClosesIt() throws {
        try requireWindowServer()
        controller.show()
        pump()
        beginSend()

        bridge.emit(.progress(progress(.opening)))
        controller.dismissForAppResign()
        XCTAssertTrue(controller.window?.isVisible ?? false)

        controller.dismissForOutsideInteraction()
        XCTAssertTrue(waitUntil { self.controller.window?.isVisible == false })

        // The input survives a failed send, and the send state ends.
        bridge.emit(.failed("浏览器连接已断开"))
        XCTAssertFalse(controller.isSending)
        XCTAssertEqual(controller.content.textView.string, "Explain closures")

        controller.show()
        pump()
        controller.submit()
        XCTAssertEqual(bridge.submitted.count, 2)
        bridge.emit(.progress(progress(.preparing, ready: 1, total: 1)))
        bridge.emit(.succeeded(SendOutcome(requestId: "request-1", ok: true, sent: 1, total: 1)))

        XCTAssertTrue(controller.isShowingSendResult)
        controller.dismissForAppResign()
        XCTAssertTrue(controller.window?.isVisible ?? false, "the success result dwell survives focus loss")

        controller.dismissForOutsideInteraction()
        XCTAssertTrue(waitUntil { self.controller.window?.isVisible == false })
    }

    func testOlderExtensionStillRaisesTheBrowserOnSuccess() {
        beginSend()

        bridge.emit(.accepted)
        XCTAssertEqual(activations, [])
        XCTAssertEqual(controller.content.statusLabel.stringValue, "等待 AI 接收…")

        bridge.emit(.succeeded(SendOutcome(requestId: "request-1", ok: true, sent: 2, total: 2)))
        XCTAssertEqual(activations, ["com.example.Browser"])
        XCTAssertTrue(controller.isShowingSendResult)
    }

    func testChoosingAModeUpdatesTheHintLine() {
        let defaults = UserDefaults.standard
        let previousRaw = defaults.string(forKey: PromptModeChoice.defaultsKey)
        defer {
            if let previousRaw {
                defaults.set(previousRaw, forKey: PromptModeChoice.defaultsKey)
            } else {
                defaults.removeObject(forKey: PromptModeChoice.defaultsKey)
            }
        }

        controller.content.modePicker.onSelect?(.concise)
        XCTAssertEqual(controller.content.modePicker.selectedChoice, .concise)
        XCTAssertEqual(
            controller.content.modeHintLabel.stringValue,
            PromptModeChoice.concise.hint(in: .current)
        )
        XCTAssertEqual(
            controller.content.previewLabel.stringValue,
            PromptModePreview.text(for: .concise, language: .current)
        )
    }

    func testUnknownTotalShowsNoRatioAndBlindModeShowsCountsOnly() {
        beginSend()

        bridge.emit(.progress(progress(.preparing, ready: 2, total: 0)))
        XCTAssertEqual(controller.content.statusLabel.stringValue, "正在准备 AI…")

        bridge.emit(.progress(progress(.sending, ready: 2, total: 2, pendingCount: 1, blind: true)))
        XCTAssertEqual(controller.content.previewLabel.stringValue, "等待：1 个 AI")
        XCTAssertEqual(controller.content.previewLabel.toolTip, "等待：1 个 AI")

        bridge.emit(.failed("发送失败"))
        XCTAssertFalse(controller.content.previewLabel.stringValue.hasPrefix("等待："))
    }
}