import AppKit
import PanelizeSearchCore
import XCTest
@testable import PanelizeSearchApp

private final class TestTextViewDelegate: NSObject, NSTextViewDelegate {}

final class ComposerInteractionTests: XCTestCase {
    private var panel: NSPanel!
    private var content: ComposerContent!
    private var defaults: UserDefaults!
    private var defaultsName: String!
    private let textViewDelegate = TestTextViewDelegate()
    private var submitted = 0
    private var hidden = 0

    override func setUp() {
        super.setUp()
        _ = NSApplication.shared
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 720, height: 240),
            styleMask: [.borderless], backing: .buffered, defer: false
        )
        panel.isReleasedWhenClosed = false
        content = ComposerContent()
        defaultsName = "PanelizeComposerTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: defaultsName)
        submitted = 0
        hidden = 0
        content.build(in: panel, mode: .auto, delegate: textViewDelegate, actions: ComposerActions(
            hide: {}, submit: { [weak self] in self?.submitted += 1 },
            handleEscape: {}, acceptTriggerCompletion: { false }, cyclePromptMode: { _ in },
            moveHistorySelection: { _ in false }, pickHistorySuggestion: { _ in },
            applyPromptMode: { _ in }, toggleNewChat: { _ in }, openBridgeSettings: {}
        ))
    }

    override func tearDown() {
        panel.close()
        defaults.removePersistentDomain(forName: defaultsName)
        content = nil
        panel = nil
        defaults = nil
        super.tearDown()
    }

    private func suggestions(mode: PromptModeChoice = .auto) -> ComposerSuggestions {
        ComposerSuggestions(
            content: content, isSending: { false }, promptMode: { mode },
            refreshPreview: {}, hidePanel: { [weak self] in self?.hidden += 1 },
            historyStore: PromptHistoryStore(defaults: defaults)
        )
    }

    func testModeHintLineIsVisibleByDefaultAndFollowsThePicker() {
        XCTAssertFalse(content.modeHintLabel.isHidden)
        XCTAssertEqual(
            content.modeHintLabel.stringValue,
            PromptModeChoice.auto.hint(in: .current)
        )
        XCTAssertEqual(
            content.modeHintLabel.toolTip,
            PromptModeChoice.auto.hint(in: .current)
        )

        content.updateModeHint(for: .concise)
        XCTAssertEqual(
            content.modeHintLabel.stringValue,
            PromptModeChoice.concise.hint(in: .current)
        )
        XCTAssertEqual(
            content.modeHintLabel.toolTip,
            PromptModeChoice.concise.hint(in: .current)
        )
    }

    func testNativeModeMenuShowsTheExplanationAsSubtitle() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.isOperatingSystemAtLeast(
            OperatingSystemVersion(majorVersion: 14, minorVersion: 4, patchVersion: 0)
        ), "NSMenuItem.subtitle requires macOS 14.4")

        let menu = content.modePicker.makeMenu(useNativeSubtitle: true)
        XCTAssertEqual(menu.items.count, 8, "seven modes plus the separator after Auto")
        let modeItems = menu.items.filter { !$0.isSeparatorItem }
        XCTAssertEqual(modeItems.map { $0.representedObject as? String },
                       PromptModeChoice.allCases.map(\.rawValue))
        XCTAssertFalse(menu.items.contains { !$0.isSeparatorItem && !$0.isEnabled })

        for item in modeItems {
            guard let raw = item.representedObject as? String,
                  let choice = PromptModeChoice(rawValue: raw) else {
                return XCTFail("Missing mode on a menu item")
            }
            if #available(macOS 14.4, *) {
                XCTAssertEqual(item.subtitle, menuHint(for: choice))
            } else {
                XCTFail("NSMenuItem.subtitle requires macOS 14.4")
            }
            XCTAssertEqual(item.toolTip, menuHint(for: choice))
            XCTAssertEqual(item.state, choice == .auto ? .on : .off)
        }
    }

    func testLegacyModeMenuShowsADisabledHintRowUnderEachMode() {
        let menu = content.modePicker.makeMenu(useNativeSubtitle: false)
        XCTAssertEqual(menu.items.count, 15, "seven modes, seven hint rows and one separator")

        let modes = menu.items.filter { !$0.isSeparatorItem && $0.isEnabled }
        XCTAssertEqual(modes.map { $0.representedObject as? String },
                       PromptModeChoice.allCases.map(\.rawValue))

        let hints = menu.items.filter { !$0.isSeparatorItem && !$0.isEnabled }
        XCTAssertEqual(hints.count, PromptModeChoice.allCases.count)
        XCTAssertEqual(hints.first?.title, PromptModeChoice.defaultMode.hint(in: .current))
        XCTAssertEqual(hints.first?.indentationLevel, 1)
    }

    private func menuHint(for choice: PromptModeChoice) -> String {
        let hint = choice.hint(in: .current)
        guard hint.count > 120 else { return hint }
        return String(hint.prefix(119)) + "…"
    }

    func testSendButtonForwardsExactlyOneActionWithoutOpeningThePanel() {
        content.sendButton.performClick(nil)
        XCTAssertEqual(submitted, 1)
        XCTAssertFalse(panel.isVisible)
    }

    func testSendButtonBusyStateDisablesAndRestores() {
        content.sendButton.setSending(true, animated: false)
        XCTAssertFalse(content.sendButton.isEnabled)
        XCTAssertTrue(content.sendButton.isBusy)

        content.sendButton.setSending(false, animated: false)
        XCTAssertTrue(content.sendButton.isEnabled)
        XCTAssertFalse(content.sendButton.isBusy)
    }

    func testCardBorderEmphasisIsStrongerThanResting() throws {
        let appearance = try XCTUnwrap(NSAppearance(named: .aqua))
        let resting = ComposerTheme.borderColor(in: appearance, increaseContrast: false)
        let emphasized = ComposerTheme.borderColor(
            in: appearance,
            increaseContrast: false,
            emphasized: true
        )
        XCTAssertGreaterThan(emphasized.alphaComponent, resting.alphaComponent)
    }

    func testDownPastLastHistorySuggestionReturnsToTheInput() {
        let suggestions = suggestions()
        suggestions.recordQuestion("explain first")
        suggestions.recordQuestion("explain second")
        content.textView.string = "explain"
        content.textView.setSelectedRange(NSRange(location: 7, length: 0))
        suggestions.refreshHistorySuggestions()
        XCTAssertTrue(suggestions.moveHistorySelection(1))
        XCTAssertTrue(suggestions.moveHistorySelection(1))
        XCTAssertTrue(suggestions.moveHistorySelection(1))
        XCTAssertFalse(suggestions.acceptSelectedHistory())
        XCTAssertEqual(content.textView.string, "explain")
        XCTAssertEqual(submitted, 0)
    }

    func testAcceptingHistoryFillsWithoutSending() {
        let suggestions = suggestions()
        suggestions.recordQuestion("explain first")
        content.textView.string = "explain"
        content.textView.setSelectedRange(NSRange(location: 7, length: 0))
        suggestions.refreshHistorySuggestions()
        XCTAssertTrue(suggestions.moveHistorySelection(1))
        XCTAssertTrue(suggestions.acceptSelectedHistory())
        XCTAssertEqual(content.textView.string, "explain first")
        XCTAssertEqual(submitted, 0)
        XCTAssertTrue(content.historyView.isHidden)
    }

    func testEscapeClosesSuggestionsBeforeHidingThePanel() {
        let suggestions = suggestions()
        suggestions.recordQuestion("explain first")
        content.textView.string = "explain"
        content.textView.setSelectedRange(NSRange(location: 7, length: 0))
        suggestions.refreshHistorySuggestions()
        suggestions.handleEscape()
        XCTAssertEqual(hidden, 0)
        XCTAssertTrue(content.historyView.isHidden)
        suggestions.handleEscape()
        XCTAssertEqual(hidden, 1)
    }

    func testTriggerCompletionReplacesOnlyTheTrailingTrigger() {
        let suggestions = suggestions()
        content.textView.string = "explain /st"
        content.textView.setSelectedRange(NSRange(location: 11, length: 0))
        XCTAssertTrue(suggestions.acceptTriggerCompletion())
        XCTAssertEqual(content.textView.string, "explain /study ")
        XCTAssertEqual(submitted, 0)
    }

    func testExplicitModeDoesNotAcceptAnAutoTrigger() {
        let suggestions = suggestions(mode: .concise)
        content.textView.string = "/st"
        content.textView.setSelectedRange(NSRange(location: 3, length: 0))
        XCTAssertFalse(suggestions.acceptTriggerCompletion())
        XCTAssertEqual(content.textView.string, "/st")
    }

    func testTabPrefersInlineCompletionAndOtherwiseCyclesOnlyForAnEmptyInput() {
        let textView = PromptTextView(frame: .zero)
        var completed = false
        var cycleDirections: [Bool] = []
        textView.onTabCompletion = { completed = true; return true }
        textView.onCyclePromptMode = { cycleDirections.append($0) }

        func tabEvent(modifiers: NSEvent.ModifierFlags = []) -> NSEvent {
            NSEvent.keyEvent(
                with: .keyDown, location: .zero, modifierFlags: modifiers,
                timestamp: 0, windowNumber: 0, context: nil,
                characters: "\t", charactersIgnoringModifiers: "\t",
                isARepeat: false, keyCode: 48
            )!
        }

        textView.string = "/st"
        textView.keyDown(with: tabEvent())
        XCTAssertTrue(completed)
        XCTAssertTrue(cycleDirections.isEmpty)

        textView.onTabCompletion = { false }
        textView.string = ""
        textView.keyDown(with: tabEvent())
        textView.keyDown(with: tabEvent(modifiers: .shift))
        XCTAssertEqual(cycleDirections, [true, false])

        textView.string = "existing draft"
        textView.keyDown(with: tabEvent())
        XCTAssertEqual(cycleDirections, [true, false])
    }
}
