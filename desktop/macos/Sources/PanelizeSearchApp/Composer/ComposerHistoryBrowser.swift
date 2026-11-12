import AppKit
import PanelizeSearchCore

/// Owns the two-column history browser: opening on ArrowUp, keyboard
/// navigation, filling without sending, copying, and dismissal priority.
final class ComposerHistoryBrowser {
    private unowned let content: ComposerContent
    private let store: PromptHistoryStore
    private let showStatus: (String) -> Void
    private var keyMonitor: Any?

    /// Set by the panel controller to reuse the existing "fill without send" path.
    var onFillRequested: (() -> Void)?

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

    /// Opens only when there is history to show; otherwise ArrowUp keeps its
    /// native caret behavior.
    @discardableResult
    func openIfPossible() -> Bool {
        guard !isVisible else { return true }
        let records = store.loadRecords()
        guard !records.isEmpty else { return false }
        content.historyView.dismiss()
        content.historyBrowserView.present(records: records)
        content.layout.updateInputHeight(animated: true)
        installKeyMonitor()
        return true
    }

    func close(restoreFocus: Bool) {
        guard isVisible else { return }
        content.historyBrowserView.dismiss()
        removeKeyMonitor()
        content.layout.updateInputHeight(animated: true)
        if restoreFocus {
            content.rootView.window?.makeFirstResponder(content.textView)
        }
    }

    func update(records: [PromptHistoryRecord]) {
        guard isVisible else { return }
        content.historyBrowserView.update(records: records)
    }

    func moveSelection(_ delta: Int) {
        content.historyBrowserView.moveSelection(delta)
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
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(summary.formattedText, forType: .string)
        showStatus("总结已复制")
    }

    private func installKeyMonitor() {
        guard keyMonitor == nil else { return }
        content.historyBrowserView.onFill = { [weak self] in
            self?.onFillRequested?()
        }
        content.historyBrowserView.onCopy = { [weak self] in
            self?.copySelectedSummary()
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

    /// The composer input keeps its own key handling. The monitor only steps in
    /// while the summary text view (or a browser button) has focus.
    private func handleKey(_ event: NSEvent) -> Bool {
        guard let window = content.rootView.window, event.window === window else { return false }
        if window.firstResponder === content.textView {
            return false
        }

        switch event.keyCode {
        case 53: // Escape
            close(restoreFocus: true)
            return true
        case 126: // ArrowUp
            moveSelection(-1)
            return true
        case 125: // ArrowDown
            moveSelection(1)
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
}