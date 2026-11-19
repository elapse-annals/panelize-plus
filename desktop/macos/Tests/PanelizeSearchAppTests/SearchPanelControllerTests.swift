import AppKit
import PanelizeSearchCore
import XCTest
@testable import PanelizeSearchApp

private final class FakeSendBridge: GlobalSendBridge {
    var connectedBrowserBundleIdentifier: String? = "com.example.Browser"
    var isExtensionConnected = true
    var supportsNewChat = false
    var hostSupportsNewChat = true
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

    private func seedHistoryWithSummaries(_ items: [(text: String, summary: String?)]) {
        let now = Date().timeIntervalSince1970 * 1000
        _ = historyStore.merge(items.enumerated().map { index, item in
            PromptHistoryRecord(
                text: item.text,
                createdAtMillis: now - Double(index) * 1000,
                updatedAtMillis: now - Double(index) * 1000,
                summary: item.summary.map {
                    PromptHistorySummary(blind: false, formattedText: $0, createdAtMillis: now)
                }
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

    /// Delivers the key through the application so the browser's local key
    /// monitor sees it, unlike `pressKey`, which calls the input directly.
    private func sendKey(
        _ keyCode: UInt16,
        characters: String = "",
        modifiers: NSEvent.ModifierFlags = []
    ) {
        guard let window = controller.window,
              let event = NSEvent.keyEvent(
                  with: .keyDown,
                  location: .zero,
                  modifierFlags: modifiers,
                  timestamp: 0,
                  windowNumber: window.windowNumber,
                  context: nil,
                  characters: characters,
                  charactersIgnoringModifiers: characters,
                  isARepeat: false,
                  keyCode: keyCode
              ) else {
            return XCTFail("Could not create a key event")
        }
        NSApp.sendEvent(event)
    }

    private func openHistoryBrowser() {
        pressKey(126)
        // The open animates the panel height; let the constraints settle.
        pump(0.4)
        controller.content.layout.updateInputHeight(animated: false)
        controller.window?.contentView?.layoutSubtreeIfNeeded()
    }

    private func focusSummary() {
        let summaryTextView = controller.content.historyBrowserView.summaryTextView
        controller.window?.makeFirstResponder(summaryTextView)
        XCTAssertTrue(controller.window?.firstResponder === summaryTextView)
    }

    private func withGeneralPasteboard(_ body: () -> Void) {
        let pasteboard = NSPasteboard.general
        let saved = pasteboard.string(forType: .string)
        body()
        pasteboard.clearContents()
        if let saved {
            pasteboard.setString(saved, forType: .string)
        }
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

    func testHistoryBrowserFrameNeverDismissesOrDragsThePanel() throws {
        try requireWindowServer()
        seedHistory(["First question"])
        controller.show()
        pump()
        openHistoryBrowser()

        let root = controller.content.rootView
        let browser = controller.content.historyBrowserView
        let surface = controller.content.surfaceView
        XCTAssertFalse(browser.isHidden)
        XCTAssertGreaterThan(browser.frame.width, 0)

        let browserPoint = root.convert(
            NSPoint(x: browser.bounds.midX, y: browser.bounds.midY),
            from: browser
        )
        XCTAssertEqual(root.interaction(at: browserPoint), .protect)

        let cardPoint = root.convert(
            NSPoint(x: surface.bounds.midX, y: surface.bounds.midY),
            from: surface
        )
        XCTAssertEqual(root.interaction(at: cardPoint), .drag)

        XCTAssertEqual(root.interaction(at: NSPoint(x: 0, y: 0)), .dismiss)
    }

    func testSummaryDocumentTracksTheViewportAndGrowsWithLongText() throws {
        try requireWindowServer()
        let longSummary = (0..<80)
            .map { "Line \($0) of a long AI summary that wraps when needed." }
            .joined(separator: "\n")
        seedHistoryWithSummaries([("Long question", longSummary), ("Short question", "Short.")])
        controller.show()
        pump()
        openHistoryBrowser()

        let browser = controller.content.historyBrowserView
        let textView = browser.summaryTextView
        let viewport = browser.summaryScrollView.contentSize
        XCTAssertGreaterThan(viewport.width, 0)
        XCTAssertEqual(textView.frame.width, viewport.width, accuracy: 0.5)
        XCTAssertGreaterThan(textView.frame.height, viewport.height)

        // A narrower window reflows the document to the new viewport width.
        guard var frame = controller.window?.frame else { return XCTFail("Missing window") }
        frame.size.width -= 80
        controller.window?.setFrame(frame, display: false)
        controller.window?.contentView?.layoutSubtreeIfNeeded()
        let narrower = browser.summaryScrollView.contentSize
        XCTAssertLessThan(narrower.width, viewport.width)
        XCTAssertEqual(textView.frame.width, narrower.width, accuracy: 0.5)
        XCTAssertGreaterThanOrEqual(textView.frame.height, narrower.height)

        // Switching to the short summary clears the old selection and still
        // fills the viewport.
        browser.select(1)
        controller.window?.contentView?.layoutSubtreeIfNeeded()
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 0))
        XCTAssertTrue(textView.string.contains("Short."))
        XCTAssertGreaterThanOrEqual(
            textView.frame.height,
            browser.summaryScrollView.contentSize.height
        )
        XCTAssertEqual(textView.frame.width, browser.summaryScrollView.contentSize.width, accuracy: 0.5)
    }

    func testUnrelatedHistoryUpdateKeepsTheSummarySelection() throws {
        try requireWindowServer()
        seedHistoryWithSummaries([
            ("First question", "First summary body.\nSecond line."),
            ("Second question", "Second summary body.")
        ])
        controller.show()
        pump()
        openHistoryBrowser()

        let textView = controller.content.historyBrowserView.summaryTextView
        let selection = NSRange(location: 5, length: 6)
        textView.setSelectedRange(selection)

        controller.historyDidChange(historyStore.loadRecords())
        XCTAssertEqual(textView.selectedRange(), selection)

        // A different record replaces the text and starts a clean selection.
        controller.content.historyBrowserView.select(1)
        XCTAssertTrue(textView.string.contains("Second summary body."))
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 0))
    }

    func testCommandCCopiesTheWholeSummaryAndTheButtonDoesToo() throws {
        try requireWindowServer()
        let summary = "## Heading\nA summary body line."
        seedHistoryWithSummaries([("Summarized question", summary)])
        controller.show()
        pump()
        openHistoryBrowser()

        var copied: String?
        controller.historyBrowser.pasteboardWriter = { text in
            copied = text
            return true
        }

        sendKey(8, characters: "c", modifiers: .command)
        XCTAssertEqual(copied, summary)
        XCTAssertEqual(controller.content.statusLabel.stringValue, "总结已复制")

        // The copy button always copies the whole summary, selection or not.
        controller.content.historyBrowserView.summaryTextView.setSelectedRange(
            NSRange(location: 0, length: 4)
        )
        copied = nil
        controller.content.historyBrowserView.copyButton.performClick(nil)
        XCTAssertEqual(copied, summary)
    }

    func testCopyFailureOmitsTheSuccessHint() throws {
        try requireWindowServer()
        seedHistoryWithSummaries([("Summarized question", "A summary body.")])
        controller.show()
        pump()
        openHistoryBrowser()

        let before = controller.content.statusLabel.stringValue
        controller.historyBrowser.pasteboardWriter = { _ in false }
        sendKey(8, characters: "c", modifiers: .command)
        XCTAssertEqual(controller.content.statusLabel.stringValue, before)
    }

    func testCommandCCopiesTheSelectionWhenThereIsOne() throws {
        try requireWindowServer()
        seedHistoryWithSummaries([("Summarized question", "Selection target text.")])
        controller.show()
        pump()
        openHistoryBrowser()
        focusSummary()

        let textView = controller.content.historyBrowserView.summaryTextView
        let selection = NSRange(location: 0, length: 6)
        textView.setSelectedRange(selection)
        let expected = (textView.string as NSString).substring(with: selection)

        var wholeCopy: String?
        controller.historyBrowser.pasteboardWriter = { text in
            wholeCopy = text
            return true
        }
        withGeneralPasteboard {
            NSPasteboard.general.clearContents()
            sendKey(8, characters: "c", modifiers: .command)
            XCTAssertEqual(NSPasteboard.general.string(forType: .string), expected)
        }
        XCTAssertNil(wholeCopy, "a selection must not copy the whole summary")
    }

    func testCommandCWithoutASummaryConsumesTheKeyAndKeepsTheClipboard() throws {
        try requireWindowServer()
        seedHistoryWithSummaries([("Plain question", nil)])
        controller.show()
        pump()
        openHistoryBrowser()

        let before = controller.content.statusLabel.stringValue
        var copied: String?
        controller.historyBrowser.pasteboardWriter = { text in
            copied = text
            return true
        }
        XCTAssertFalse(controller.content.historyBrowserView.copyButton.isEnabled)

        withGeneralPasteboard {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString("sentinel", forType: .string)
            sendKey(8, characters: "c", modifiers: .command)
            XCTAssertEqual(NSPasteboard.general.string(forType: .string), "sentinel")
        }
        XCTAssertNil(copied)
        XCTAssertEqual(controller.content.statusLabel.stringValue, before)
    }

    func testArrowKeysMoveTheSummaryCaretAndCollapseSelections() throws {
        try requireWindowServer()
        seedHistoryWithSummaries([
            ("Q", "line one is here\nline two is here\nline three is here")
        ])
        controller.show()
        pump()
        openHistoryBrowser()
        focusSummary()

        let textView = controller.content.historyBrowserView.summaryTextView
        let text = textView.string as NSString
        let secondLine = text.range(of: "line two").location
        XCTAssertNotEqual(secondLine, NSNotFound)

        let caret = secondLine + 4
        textView.setSelectedRange(NSRange(location: caret, length: 0))
        sendKey(126)
        let afterUp = textView.selectedRange()
        XCTAssertEqual(afterUp.length, 0)
        XCTAssertLessThan(afterUp.location, caret)

        sendKey(125)
        let afterDown = textView.selectedRange()
        XCTAssertEqual(afterDown.length, 0)
        XCTAssertGreaterThan(afterDown.location, afterUp.location)

        textView.setSelectedRange(NSRange(location: secondLine, length: 4))
        sendKey(126)
        XCTAssertEqual(textView.selectedRange(), NSRange(location: secondLine, length: 0))

        textView.setSelectedRange(NSRange(location: secondLine, length: 4))
        sendKey(125)
        XCTAssertEqual(textView.selectedRange(), NSRange(location: secondLine + 4, length: 0))
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

    func testCheckingNewChatWithLegacyHostShowsReinstallHintAndSkipsRequest() {
        bridge.supportsNewChat = false
        bridge.hostSupportsNewChat = false
        toggleNewChat(on: true)

        XCTAssertTrue(controller.content.statusLabel.stringValue.contains("重新安装"))
        XCTAssertTrue(bridge.newChatRequestIds.isEmpty)
        XCTAssertEqual(controller.content.newChatCheckbox.state, .on)
    }

    func testCheckingNewChatWithAnOlderExtensionShowsExtensionHint() {
        bridge.supportsNewChat = false
        bridge.hostSupportsNewChat = true
        toggleNewChat(on: true)

        XCTAssertTrue(controller.content.statusLabel.stringValue.contains("扩展"))
        XCTAssertTrue(bridge.newChatRequestIds.isEmpty)
        XCTAssertEqual(controller.content.newChatCheckbox.state, .on)
    }

    func testVersionHintIsShownAndDoesNotBlockSending() {
        controller.setConnectionStatus(
            "Panelize 2.94.1 已连接",
            ready: true,
            versionHint: "扩展版本较旧，建议更新"
        )

        XCTAssertEqual(controller.content.statusLabel.stringValue, "扩展版本较旧，建议更新")
        XCTAssertFalse(controller.content.statusLabel.isHidden)
        XCTAssertTrue(controller.content.statusStack.isActionable)

        controller.content.textView.string = "Still send"
        controller.submit()
        XCTAssertEqual(bridge.submitted.last?.text, "Still send")
    }

    func testTransientStatusRestoresTheVersionHint() {
        controller.setConnectionStatus(
            "Panelize 2.94.1 已连接",
            ready: true,
            versionHint: "扩展版本较旧，建议更新"
        )
        bridge.supportsNewChat = false
        bridge.hostSupportsNewChat = true
        toggleNewChat(on: true)
        XCTAssertTrue(controller.content.statusLabel.stringValue.contains("扩展版本过旧"))

        XCTAssertTrue(waitUntil(timeout: 3) {
            self.controller.content.statusLabel.stringValue == "扩展版本较旧，建议更新"
        })
    }

    func testReadyWithoutHintKeepsTheGreenCheckOnly() {
        controller.setConnectionStatus("Panelize 2.95.0 已连接", ready: true)

        XCTAssertTrue(controller.content.statusLabel.isHidden)
        XCTAssertEqual(controller.content.statusLabel.stringValue, "")
        XCTAssertFalse(controller.content.statusStack.isActionable)
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