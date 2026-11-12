import AppKit
import PanelizeSearchCore
import XCTest
@testable import PanelizeSearchApp

private final class FakeSendBridge: GlobalSendBridge {
    var connectedBrowserBundleIdentifier: String? = "com.example.Browser"
    var isExtensionConnected = true
    var supportsNewChat = false
    private var updateHandler: ((BridgeSendUpdate) -> Void)?
    private(set) var submitted: [(text: String, mode: PromptModeChoice)] = []
    private(set) var newChatFlags: [Bool] = []
    private(set) var newChatRequestIds: [String] = []
    private(set) var historySyncRequests = 0
    private var newChatHandler: ((NewChatUpdate) -> Void)?

    func sendPrompt(
        _ text: String,
        promptMode: PromptModeChoice,
        update: @escaping (BridgeSendUpdate) -> Void
    ) -> Bool {
        submitted.append((text, promptMode))
        updateHandler = update
        return true
    }

    func sendPrompt(
        _ text: String,
        promptMode: PromptModeChoice,
        newChat: Bool,
        update: @escaping (BridgeSendUpdate) -> Void
    ) -> Bool {
        newChatFlags.append(newChat)
        return sendPrompt(text, promptMode: promptMode, update: update)
    }

    @discardableResult
    func requestNewChat(requestId: String, update: @escaping (NewChatUpdate) -> Void) -> Bool {
        guard supportsNewChat else {
            update(.failed("not-connected"))
            return false
        }
        newChatRequestIds.append(requestId)
        newChatHandler = update
        return true
    }

    func requestHistorySync(force: Bool) {
        historySyncRequests += 1
    }

    func completeNewChat(ok: Bool, ready: Int, total: Int) {
        guard let requestId = newChatRequestIds.last else { return }
        newChatHandler?(.succeeded(NewChatOutcome(
            requestId: requestId,
            ok: ok,
            ready: ready,
            total: total
        )))
    }

    func emit(_ update: BridgeSendUpdate) {
        updateHandler?(update)
    }
}

final class SearchPanelControllerTests: XCTestCase {
    private var bridge: FakeSendBridge!
    private var controller: SearchPanelController!
    private var activations: [String] = []
    private var defaults: UserDefaults!
    private var defaultsName: String!
    private var historyStore: PromptHistoryStore!
    private var newChatPreference: NewChatPreference!

    override func setUp() {
        super.setUp()
        _ = NSApplication.shared
        bridge = FakeSendBridge()
        activations = []
        defaultsName = "PanelizeSearchPanelTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: defaultsName)
        historyStore = PromptHistoryStore(defaults: defaults, key: "history")
        newChatPreference = NewChatPreference(defaults: defaults, key: "newChat")
        controller = SearchPanelController(
            bridge: bridge,
            activateBrowser: { [weak self] identifier in
                self?.activations.append(identifier)
                return true
            },
            historyStore: historyStore,
            newChatPreference: newChatPreference
        )
    }

    override func tearDown() {
        controller?.hide()
        controller?.window?.close()
        controller = nil
        bridge = nil
        defaults.removePersistentDomain(forName: defaultsName)
        defaults = nil
        historyStore = nil
        newChatPreference = nil
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

    // MARK: - Two-column history browser

    private func seedHistory(_ texts: [String]) {
        let now = Date().timeIntervalSince1970 * 1000
        _ = historyStore.merge(texts.enumerated().map { index, text in
            PromptHistoryRecord(
                text: text,
                createdAtMillis: now - Double(index) * 1000,
                updatedAtMillis: now - Double(index) * 1000
            )
        }, nowMillis: now)
    }

    private func pressKey(_ keyCode: UInt16, characters: String = "") {
        guard let event = NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [],
            timestamp: 0,
            windowNumber: controller.window?.windowNumber ?? 0,
            context: nil,
            characters: characters,
            charactersIgnoringModifiers: characters,
            isARepeat: false,
            keyCode: keyCode
        ) else {
            return XCTFail("Could not create a key event")
        }
        controller.content.textView.keyDown(with: event)
    }

    func testArrowUpOnEmptyInputOpensHistoryAndEnterFillsWithoutSending() throws {
        try requireWindowServer()
        seedHistory(["First question", "Second question"])
        controller.show()

        pressKey(126)
        XCTAssertFalse(controller.content.historyBrowserView.isHidden)
        XCTAssertEqual(controller.content.historyBrowserView.selectedRecord?.text, "First question")

        pressKey(125)
        XCTAssertEqual(controller.content.historyBrowserView.selectedRecord?.text, "Second question")

        pressKey(36, characters: "\r")
        XCTAssertTrue(controller.content.historyBrowserView.isHidden)
        XCTAssertEqual(controller.content.textView.string, "Second question")
        XCTAssertTrue(bridge.submitted.isEmpty, "Filling history must not send it")
    }

    func testArrowUpWithTextPreservesTheUsualInputBehavior() throws {
        try requireWindowServer()
        seedHistory(["First question"])
        controller.show()
        controller.content.textView.string = "abc"

        pressKey(126)
        XCTAssertTrue(controller.content.historyBrowserView.isHidden)
    }

    func testEscapeClosesTheBrowserBeforeThePanelAndTypingDismissesIt() throws {
        try requireWindowServer()
        seedHistory(["First question"])
        controller.show()
        pressKey(126)
        XCTAssertFalse(controller.content.historyBrowserView.isHidden)

        pressKey(53)
        XCTAssertTrue(controller.content.historyBrowserView.isHidden)
        XCTAssertTrue(controller.window?.isVisible == true, "Esc must not hide the panel while it only closes history")

        pressKey(126)
        XCTAssertFalse(controller.content.historyBrowserView.isHidden)
        controller.content.textView.string = "typed"
        controller.textDidChange(Notification(
            name: NSText.didChangeNotification,
            object: controller.content.textView
        ))
        XCTAssertTrue(controller.content.historyBrowserView.isHidden)
    }

    func testLiveHistoryUpdateKeepsTheBrowserVisibleAndSelectionStable() throws {
        try requireWindowServer()
        seedHistory(["First question", "Second question"])
        controller.show()
        pressKey(126)
        pressKey(125)
        XCTAssertEqual(controller.content.historyBrowserView.selectedRecord?.text, "Second question")

        let now = Date().timeIntervalSince1970 * 1000
        let records = historyStore.loadRecords().map { record in
            if record.text == "First question" {
                return PromptHistoryRecord(
                    text: record.text,
                    createdAtMillis: record.createdAtMillis,
                    updatedAtMillis: record.updatedAtMillis,
                    summary: PromptHistorySummary(
                        blind: true,
                        formattedText: "Anonymous model 1: fresh summary",
                        createdAtMillis: now
                    )
                )
            }
            return record
        }
        controller.historyDidChange(records)

        XCTAssertFalse(controller.content.historyBrowserView.isHidden)
        XCTAssertEqual(controller.content.historyBrowserView.selectedRecord?.text, "Second question")
        XCTAssertEqual(controller.content.historyBrowserView.records.count, 2)
    }

    // MARK: - New chat checkbox

    private func toggleNewChat(on: Bool) {
        let checkbox = controller.content.newChatCheckbox
        checkbox.state = on ? .on : .off
        _ = checkbox.sendAction(checkbox.action, to: checkbox.target)
    }

    func testCheckingNewChatPersistsAndRequestsImmediatelyWhenSupported() {
        bridge.supportsNewChat = true
        toggleNewChat(on: true)

        XCTAssertTrue(newChatPreference.load())
        XCTAssertEqual(bridge.newChatRequestIds.count, 1)
        XCTAssertEqual(controller.content.newChatCheckbox.state, .on)
    }

    func testSendsCarryTheNewChatFlagOnlyWhenEnabledAndSupported() {
        bridge.supportsNewChat = true
        toggleNewChat(on: true)
        controller.content.textView.string = "First round"
        controller.submit()
        XCTAssertEqual(bridge.newChatFlags.last, true)

        bridge.emit(.succeeded(SendOutcome(requestId: "request", ok: true, sent: 1, total: 1)))

        bridge.supportsNewChat = false
        controller.content.textView.string = "Second round"
        controller.submit()
        XCTAssertEqual(bridge.newChatFlags.last, false)
    }

    func testSuccessfulSendMakesTheNextShowPrepareAnotherNewChat() throws {
        try requireWindowServer()
        bridge.supportsNewChat = true
        controller.show()
        toggleNewChat(on: true)
        XCTAssertEqual(bridge.newChatRequestIds.count, 1)
        bridge.completeNewChat(ok: true, ready: 3, total: 3)

        controller.content.textView.string = "Round one"
        controller.submit()
        bridge.emit(.succeeded(SendOutcome(requestId: "request", ok: true, sent: 1, total: 1)))
        controller.hide()
        controller.show()

        XCTAssertEqual(bridge.newChatRequestIds.count, 2)
    }

    func testPartialNewChatShowsANonBlockingHintAndSendStillWorks() {
        bridge.supportsNewChat = true
        toggleNewChat(on: true)
        bridge.completeNewChat(ok: false, ready: 1, total: 3)
        XCTAssertEqual(controller.content.statusLabel.stringValue, "部分 AI 未确认新建会话")

        controller.content.textView.string = "Still send"
        controller.submit()
        XCTAssertEqual(bridge.submitted.last?.text, "Still send")
        XCTAssertEqual(bridge.newChatFlags.last, true)
    }

    func testShowAndExtensionConnectionRequestHistorySync() throws {
        try requireWindowServer()
        controller.show()
        XCTAssertGreaterThanOrEqual(bridge.historySyncRequests, 1)
        let previous = bridge.historySyncRequests
        controller.handleExtensionConnected()
        XCTAssertGreaterThan(bridge.historySyncRequests, previous)
    }
}