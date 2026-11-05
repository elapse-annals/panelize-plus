import AppKit
import PanelizeSearchCore

/// Owns the input/history heights and the window's resulting frame.
final class ComposerLayoutController {
    private unowned let content: ComposerContent
    private var window: NSWindow? { content.rootView.window }

    init(content: ComposerContent) {
        self.content = content
    }

    func bind(scroll: NSLayoutConstraint, card: NSLayoutConstraint, history: NSLayoutConstraint) {
        scrollHeightConstraint = scroll
        cardHeightConstraint = card
        historyHeightConstraint = history
    }

    private var historyHeightConstraint: NSLayoutConstraint?
    private var currentSuggestionHeight: CGFloat = 0
    private var scrollHeightConstraint: NSLayoutConstraint?
    private var cardHeightConstraint: NSLayoutConstraint?
    private var historyPanelHeight: CGFloat = 0
    private(set) var currentInputHeight = ComposerMetrics.baseInputHeight

    var composerContentSize: CGSize {
        CGSize(
            width: ComposerMetrics.contentWidth,
            height: composerContentHeight(
                inputHeight: currentInputHeight,
                suggestionHeight: currentSuggestionHeight
            )
        )
    }

    var composerWindowSize: CGSize {
        CGSize(
            width: composerContentSize.width + ComposerMetrics.shadowInset * 2,
            height: composerContentSize.height + ComposerMetrics.shadowInset * 2
        )
    }

    private func desiredInputHeight() -> CGFloat {
        guard let layoutManager = content.textView.layoutManager,
              let container = content.textView.textContainer else {
            return ComposerMetrics.baseInputHeight
        }
        layoutManager.ensureLayout(for: container)
        let textHeight = layoutManager.usedRect(for: container).height
            + content.textView.textContainerInset.height * 2
        return composerInputHeight(forTextHeight: textHeight)
    }

    func updateInputHeight(animated: Bool) {
        guard let panel = window else { return }
        let desired = desiredInputHeight()
        let desiredSuggestion = content.historyView.contentHeight
        historyPanelHeight = desiredSuggestion
        updateHistoryPanelVisibility()
        guard abs(desired - currentInputHeight) > 0.5
                || abs(desiredSuggestion - currentSuggestionHeight) > 0.5 else { return }
        currentInputHeight = desired
        currentSuggestionHeight = desiredSuggestion

        let desiredCard = composerCardHeight(inputHeight: desired)
        var frame = panel.frame
        frame.size = composerWindowSize
        let apply = {
            self.scrollHeightConstraint?.constant = desired
            self.cardHeightConstraint?.constant = desiredCard
            self.historyHeightConstraint?.constant = desiredSuggestion
        }

        if animated, panel.isVisible,
           !ComposerAccessibilityOptions.current.reduceMotion {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.16
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                self.scrollHeightConstraint?.animator().constant = desired
                self.cardHeightConstraint?.animator().constant = desiredCard
                self.historyHeightConstraint?.animator().constant = desiredSuggestion
                panel.animator().setFrame(frame, display: true)
            } completionHandler: { [weak self] in
                self?.content.textView.scrollRangeToVisible(
                    self?.content.textView.selectedRange() ?? NSRange(location: 0, length: 0)
                )
            }
        } else {
            apply()
            panel.setFrame(frame, display: true)
            panel.contentView?.layoutSubtreeIfNeeded()
            content.textView.scrollRangeToVisible(content.textView.selectedRange())
        }
    }

    /// The history panel and its shadow show only while rows are available.
    /// With reduced transparency the material backdrop is hidden, like the card.
    func updateHistoryPanelVisibility() {
        let visible = historyPanelHeight > 0
        content.historyPanelShadow.isHidden = !visible
        content.historyPanelBackdrop.isHidden = !visible
            || ComposerAccessibilityOptions.current.reduceTransparency
        content.historyPanelSurface.isHidden = !visible
    }
}
