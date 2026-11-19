import AppKit
import PanelizeSearchCore

/// Owns the two-column history browser: opening on ArrowUp, keyboard
/// navigation, filling without sending, copying, and dismissal priority.
/// It also coordinates the expanded full-width reading mode, including when
/// the screen has room to grow and which focus to restore on return.
final class ComposerHistoryBrowser {
    private unowned let content: ComposerContent
    private let store: PromptHistoryStore
    private let showStatus: (String) -> Void
    private var keyMonitor: Any?
    /// The view that had focus when the reading view expanded, so returning
    /// can restore it when it is still usable.
    private weak var focusBeforeZoom: NSView?

    /// Set by the panel controller to reuse the existing "fill without send" path.
    var onFillRequested: (() -> Void)?

    /// Writes the full summary to the clipboard. Returns whether the clipboard
    /// took the text; tests substitute a failing writer to check that no
    /// success hint appears.
    var pasteboardWriter: (String) -> Bool = { text in
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        return pasteboard.setString(text, forType: .string)
    }

    init(
        content: ComposerContent,
        store: PromptHistoryStore,
        showStatus: @escaping (String) -> Void
    ) {
        self.content = content
        self.store = store
        self.showStatus = showStatus
    }

    var isVisible: Bool {
        !content.historyBrowserView.isHidden
    }

    var isZoomed: Bool {
        content.historyBrowserView.isZoomed
    }

    /// Opens only when there is history to show and the screen has room for
    /// the browser's header, one body line and its footer; otherwise ArrowUp
    /// keeps its native caret behavior.
    @discardableResult
    func openIfPossible() -> Bool {
        guard !isVisible else { return true }
        let records = store.loadRecords()
        guard !records.isEmpty else { return false }
        guard content.layout.canFitHistoryBrowser(mode: .twoColumn) else { return false }
        content.historyView.dismiss()
        content.historyBrowserView.present(records: records)
        content.layout.updateInputHeight(animated: true)
        installKeyMonitor()
        return true
    }

    func close(restoreFocus: Bool) {
        guard isVisible else { return }
        focusBeforeZoom = nil
        content.historyBrowserView.dismiss()
        removeKeyMonitor()
        content.layout.updateInputHeight(animated: true)
        if restoreFocus {
            content.rootView.window?.makeFirstResponder(content.textView)
        }
    }

    func update(records: [PromptHistoryRecord]) {
        guard isVisible else { return }
        // The history was cleared while the browser was open: close through the
        // panel's own path so focus returns to the input.
        guard !records.isEmpty else {
            close(restoreFocus: true)
            return
        }
        let wasZoomed = content.historyBrowserView.isZoomed
        content.historyBrowserView.update(records: records)
        if wasZoomed, !content.historyBrowserView.isZoomed {
            // The selected record disappeared or lost its summary, so the view
            // left the expanded layout itself; shrink the window to match.
            focusBeforeZoom = nil
            updateHistoryHeight()
        }
    }

    func moveSelection(_ delta: Int) {
        content.historyBrowserView.moveSelection(delta)
    }

    /// Scrolls the expanded body by one line; the controller's ArrowUp/Down
    /// action routes here while the reading view is open.
    func scrollSummary(_ delta: Int) {
        content.historyBrowserView.scrollSummary(up: delta < 0, byPage: false)
    }

    /// Fills the input with the highlighted question and closes the browser.
    func takeSelectedQuestion() -> String? {
        guard let record = content.historyBrowserView.selectedRecord else { return nil }
        close(restoreFocus: true)
        return record.text
    }

    func copySelectedSummary() {
        guard let summary = content.historyBrowserView.selectedRecord?.summary,
              !summary.formattedText.isEmpty else {
            return
        }
        guard pasteboardWriter(summary.formattedText) else { return }
        showStatus("总结已复制")
    }

    // MARK: - Expanded reading mode

    /// All entry points (the → key, the icon, "放大总结" and a double click)
    /// share this check: a summary is required and the screen must have room,
    /// otherwise the two-column layout stays exactly as it is.
    func zoomIfPossible() {
        let browser = content.historyBrowserView
        guard isVisible, !browser.isZoomed, browser.selectedRecord?.hasSummary == true else {
            return
        }
        guard content.layout.canFitHistoryBrowser(mode: .zoomed) else {
            if !content.layout.canFitHistoryBrowser(mode: .twoColumn) {
                close(restoreFocus: true)
            }
            return
        }
        focusBeforeZoom = content.rootView.window?.firstResponder as? NSView
        setZoomed(true)
        content.rootView.window?.makeFirstResponder(browser.summaryTextView)
    }

    /// Escape and ← return to the two-column layout first; a later Escape
    /// closes the browser through the usual path.
    func goBackToList() {
        let browser = content.historyBrowserView
        guard isVisible, browser.isZoomed else { return }
        browser.dismissQuestionOverlay(refocus: false)
        guard content.layout.canFitHistoryBrowser(mode: .twoColumn) else {
            close(restoreFocus: true)
            return
        }
        setZoomed(false)
        restoreFocusAfterZoom()
    }

    /// Handles Escape from any focus: the full-question overlay first, then
    /// the expanded layout, then the browser itself. Returns whether it acted.
    @discardableResult
    func handleEscape() -> Bool {
        guard isVisible else { return false }
        let browser = content.historyBrowserView
        if browser.isQuestionOverlayVisible {
            browser.dismissQuestionOverlay()
            return true
        }
        if browser.isZoomed {
            goBackToList()
            return true
        }
        close(restoreFocus: true)
        return true
    }

    private func setZoomed(_ zoomed: Bool) {
        let browser = content.historyBrowserView
        let generation = browser.setZoomed(zoomed)
        content.layout.updateInputHeight(animated: true) { [weak self] in
            self?.content.historyBrowserView.finishZoomTransition(generation: generation)
        }
    }

    /// A data refresh may leave the expanded layout inside the view itself;
    /// only the window height still needs to follow.
    private func updateHistoryHeight() {
        let generation = content.historyBrowserView.modeTransitionGeneration
        content.layout.updateInputHeight(animated: true) { [weak self] in
            self?.content.historyBrowserView.finishZoomTransition(generation: generation)
        }
    }

    private func restoreFocusAfterZoom() {
        guard let window = content.rootView.window else { return }
        defer { focusBeforeZoom = nil }
        if let previous = focusBeforeZoom,
           previous.window === window,
           !previous.isHiddenOrHasHiddenAncestor,
           window.makeFirstResponder(previous) {
            return
        }
        window.makeFirstResponder(content.textView)
    }

    // MARK: - Keyboard

    private func installKeyMonitor() {
        guard keyMonitor == nil else { return }
        let browser = content.historyBrowserView
        browser.onFill = { [weak self] in
            self?.onFillRequested?()
        }
        browser.onCopy = { [weak self] in
            self?.copySelectedSummary()
        }
        browser.onZoomRequested = { [weak self] in
            self?.zoomIfPossible()
        }
        browser.onBackRequested = { [weak self] in
            self?.goBackToList()
        }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.isVisible else { return event }
            return self.handleKey(event) ? nil : event
        }
    }

    private func removeKeyMonitor() {
        if let keyMonitor {
            NSEvent.removeMonitor(keyMonitor)
            self.keyMonitor = nil
        }
    }

    /// Validates the window and any in-flight input method composition before
    /// any other interception. The composer input keeps its own key handling
    /// for plain editing; the monitor only steps in for browser actions.
    private func handleKey(_ event: NSEvent) -> Bool {
        guard let window = content.rootView.window, event.window === window else { return false }
        guard !hasMarkedText(in: window) else { return false }

        let browser = content.historyBrowserView

        // The full-question overlay is modal over the expanded reading view:
        // Escape closes it and everything else keeps native text handling.
        if browser.isQuestionOverlayVisible {
            guard event.keyCode == 53 else { return false }
            guard !event.isARepeat else { return true }
            browser.dismissQuestionOverlay()
            return true
        }

        // Command-C works from either focus: a selection copies natively, and
        // with no selection the whole summary goes to the clipboard. A record
        // without a summary consumes the key and leaves both untouched.
        if isCopyCommand(event) {
            copySelectionOrSummary()
            return true
        }

        if browser.isZoomed {
            return handleZoomedKey(event)
        }

        // Two-column → expands the reading view before the input sees it.
        if event.keyCode == 124, isBareKey(event), browser.canZoom {
            zoomIfPossible()
            return true
        }

        if window.firstResponder === content.textView {
            return false
        }

        switch event.keyCode {
        case 53: // Escape
            close(restoreFocus: true)
            return true
        case 124: // ArrowRight without a summary: never close just for pressing it
            guard isBareKey(event) else { return false }
            return true
        case 126, 125: // ArrowUp / ArrowDown
            if window.firstResponder === browser.summaryTextView {
                return handleSummaryArrow(up: event.keyCode == 126, event: event)
            }
            moveSelection(event.keyCode == 126 ? -1 : 1)
            return true
        case 36, 76: // Return / keypad Enter
            onFillRequested?()
            return true
        default:
            let flags = event.modifierFlags.intersection([.command, .control, .option])
            guard flags.isEmpty,
                  let characters = event.characters,
                  !characters.isEmpty,
                  !characters.unicodeScalars.allSatisfy({ CharacterSet.newlines.contains($0) }) else {
                return false
            }
            // Typing dismisses the browser and continues in the input.
            close(restoreFocus: true)
            return false
        }
    }

    /// Expanded-mode hotkeys work from the input, the body and the buttons.
    /// Navigation and modifier-select keys keep their native behavior.
    private func handleZoomedKey(_ event: NSEvent) -> Bool {
        let browser = content.historyBrowserView
        if isBareKey(event) {
            switch event.keyCode {
            case 53, 123: // Escape / ArrowLeft
                guard !event.isARepeat else { return true }
                goBackToList()
                return true
            case 126, 125: // ArrowUp / ArrowDown
                browser.scrollSummary(up: event.keyCode == 126, byPage: false)
                return true
            case 116, 121: // PageUp / PageDown
                browser.scrollSummary(up: event.keyCode == 116, byPage: true)
                return true
            case 36, 76: // Return / keypad Enter
                guard !event.isARepeat else { return true }
                onFillRequested?()
                return true
            default:
                break
            }
            if isPlainCharacter(event) {
                // Typing leaves the reading view and continues in the input;
                // AppKit delivers the returned event exactly once.
                close(restoreFocus: true)
                return false
            }
        }
        return false
    }

    private func isBareKey(_ event: NSEvent) -> Bool {
        event.modifierFlags
            .intersection([.command, .control, .option, .shift])
            .isEmpty
    }

    /// A printable character typed without command, control or option. Shift is
    /// allowed, but function and navigation keys (private-use scalars), Tab,
    /// delete and newlines are not characters here.
    private func isPlainCharacter(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.command, .control, .option])
        guard flags.isEmpty,
              let characters = event.characters,
              !characters.isEmpty else {
            return false
        }
        return characters.unicodeScalars.allSatisfy { scalar in
            scalar.value >= 0x20
                && scalar.value != 0x7F
                && !(0xF700...0xF8FF).contains(scalar.value)
        }
    }

    private func hasMarkedText(in window: NSWindow) -> Bool {
        if content.textView.hasMarkedText() { return true }
        if let textView = window.firstResponder as? NSTextView, textView.hasMarkedText() {
            return true
        }
        return false
    }

    private func isCopyCommand(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
        return flags == .command
            && event.charactersIgnoringModifiers?.lowercased() == "c"
    }

    private func copySelectionOrSummary() {
        let summaryTextView = content.historyBrowserView.summaryTextView
        if summaryTextView.selectedRange().length > 0 {
            summaryTextView.copy(nil)
            return
        }
        copySelectedSummary()
    }

    /// The read-only summary keeps native shift-selection, but plain ArrowUp /
    /// ArrowDown do not move its insertion point. Ask the text view's own
    /// extend-selection command for the target, then collapse in the arrow's
    /// direction. An existing selection collapses to its start (up) or end
    /// (down) without moving.
    private func handleSummaryArrow(up: Bool, event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.shift, .control, .option, .command])
        guard flags.isEmpty else { return false }

        let summaryTextView = content.historyBrowserView.summaryTextView
        let selection = summaryTextView.selectedRange()
        let target: Int
        if selection.length > 0 {
            target = up ? selection.location : NSMaxRange(selection)
        } else {
            let command = Selector(up ? "moveUpAndModifySelection:" : "moveDownAndModifySelection:")
            summaryTextView.setSelectedRange(NSRange(location: selection.location, length: 0))
            summaryTextView.doCommand(by: command)
            let extended = summaryTextView.selectedRange()
            target = up ? extended.location : NSMaxRange(extended)
        }

        let collapsed = NSRange(location: target, length: 0)
        summaryTextView.setSelectedRange(collapsed)
        summaryTextView.scrollRangeToVisible(collapsed)
        return true
    }
}