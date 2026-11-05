import AppKit
import PanelizeSearchCore

/// Owns recent-question selection and inline trigger completion.
final class ComposerSuggestions {
    private let content: ComposerContent
    private let getIsSending: () -> Bool
    private let getPromptMode: () -> PromptModeChoice
    private let refreshPreview: () -> Void
    private let hidePanel: () -> Void
    private var window: NSWindow? { content.rootView.window }
    private var isSending: Bool { getIsSending() }
    private var selectedPromptMode: PromptModeChoice { getPromptMode() }

    init(
        content: ComposerContent,
        isSending: @escaping () -> Bool,
        promptMode: @escaping () -> PromptModeChoice,
        refreshPreview: @escaping () -> Void,
        hidePanel: @escaping () -> Void,
        historyStore: PromptHistoryStore = PromptHistoryStore()
    ) {
        self.content = content
        self.getIsSending = isSending
        self.getPromptMode = promptMode
        self.refreshPreview = refreshPreview
        self.hidePanel = hidePanel
        self.historyStore = historyStore
    }

    func recordQuestion(_ text: String) { historyStore.record(text) }

    func dismissCompletion() {
        currentCompletion = nil
        content.completionOverlay.dismiss()
    }

    private(set) var currentCompletion: PromptTriggerCompletion?
    private let historyStore: PromptHistoryStore
    private var historyMatches: [String] = []
    private var historySelection: Int?
    var suppressHistory = false

    /// Refreshes the rows above the input. The inline trigger completion takes
    /// precedence while it shows, so the two never compete for attention.
    func refreshHistorySuggestions() {
        guard !isSending,
              !suppressHistory,
              !content.textView.hasMarkedText(),
              content.textView.selectedRange().length == 0,
              currentCompletion == nil else {
            clearHistorySuggestions()
            return
        }

        let matches = PromptHistoryStore.matches(historyStore.load(), prefix: content.textView.string)
        if matches != historyMatches {
            historyMatches = matches
            historySelection = nil
        }
        content.historyView.present(matches, selectedIndex: historySelection)
    }

    func clearHistorySuggestions() {
        historyMatches = []
        historySelection = nil
        content.historyView.dismiss()
    }

    @discardableResult
    func moveHistorySelection(_ delta: Int) -> Bool {
        guard !historyMatches.isEmpty else { return false }
        if let selection = historySelection {
            let next = selection + delta
            if delta > 0, next >= historyMatches.count {
                // Down past the last row returns to the input.
                historySelection = nil
            } else {
                historySelection = (next + historyMatches.count) % historyMatches.count
            }
        } else {
            historySelection = delta > 0 ? 0 : historyMatches.count - 1
        }
        content.historyView.present(historyMatches, selectedIndex: historySelection)
        return true
    }

    func acceptSelectedHistory() -> Bool {
        guard let selection = historySelection, selection < historyMatches.count else { return false }
        applyHistoryQuestion(historyMatches[selection])
        return true
    }

    func pickHistorySuggestion(at index: Int) {
        guard index >= 0, index < historyMatches.count else { return }
        applyHistoryQuestion(historyMatches[index])
    }

    /// Fills the composer with a past question without sending it.
    func applyHistoryQuestion(_ question: String) {
        suppressHistory = true
        clearHistorySuggestions()
        content.textView.string = question
        content.textView.setSelectedRange(NSRange(location: (question as NSString).length, length: 0))
        content.placeholder.isHidden = !question.isEmpty
        refreshPreview()
        refreshCompletionOverlay()
        content.layout.updateInputHeight(animated: true)
        window?.makeFirstResponder(content.textView)
    }

    /// Esc closes an open history list first; otherwise it hides the panel.
    func handleEscape() {
        guard historyMatches.isEmpty else {
            suppressHistory = true
            clearHistorySuggestions()
            content.layout.updateInputHeight(animated: false)
            return
        }
        hidePanel()
    }

    func refreshCompletionOverlay() {
        guard let panel = window,
              panel.isVisible,
              !isSending,
              selectedPromptMode == .auto,
              content.textView.window?.firstResponder === content.textView,
              !content.textView.hasMarkedText(),
              content.textView.selectedRange().length == 0 else {
            currentCompletion = nil
            content.completionOverlay.dismiss()
            return
        }

        let caret = content.textView.selectedRange().location
        guard let completion = PromptModePreview.completion(in: content.textView.string, caret: caret),
              let caretRect = content.textView.caretRect(forCharacterIndex: caret) else {
            currentCompletion = nil
            content.completionOverlay.dismiss()
            return
        }

        currentCompletion = completion
        content.completionOverlay.present(
            completion,
            at: caretRect,
            boundsWidth: content.textView.bounds.width,
            font: content.textView.font ?? .systemFont(ofSize: 20, weight: .regular)
        )
    }

    @discardableResult
    func acceptTriggerCompletion() -> Bool {
        guard !isSending,
              selectedPromptMode == .auto,
              !content.textView.hasMarkedText(),
              content.textView.selectedRange().length == 0 else {
            return false
        }

        let caret = content.textView.selectedRange().location
        guard let completion = PromptModePreview.completion(in: content.textView.string, caret: caret) else {
            return false
        }

        let text = content.textView.string as NSString
        let nextIndex = NSMaxRange(completion.range)
        let nextCharacter = nextIndex < text.length
            ? text.substring(with: NSRange(location: nextIndex, length: 1))
            : ""
        let needsSpace = nextCharacter.rangeOfCharacter(from: .whitespacesAndNewlines) == nil
        let insertion = completion.trigger + (needsSpace ? " " : "")
        let replacement = NSAttributedString(
            string: insertion,
            attributes: content.textView.typingAttributes
        )

        guard content.textView.performValidatedReplacement(in: completion.range, with: replacement) else {
            return false
        }

        content.textView.setSelectedRange(NSRange(
            location: completion.range.location + (insertion as NSString).length,
            length: 0
        ))
        refreshPreview()
        refreshCompletionOverlay()
        return true
    }
}
