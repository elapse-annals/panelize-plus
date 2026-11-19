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
    /// Which height animation is current; only its completion may restore
    /// positions so a fast mode switch cannot replay a stale layout.
    private var heightAnimationGeneration = 0
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

    /// The content origin to measure against. A visible panel keeps the card's
    /// actual bottom edge fixed; before positioning (or while hidden) the
    /// designed composer position is the target the system will use.
    private func contentBottom(
        for screen: NSScreen,
        targetContentBottom: CGFloat?
    ) -> CGFloat {
        if let targetContentBottom { return targetContentBottom }
        if let panel = window, panel.isVisible {
            return panel.frame.minY + ComposerMetrics.shadowInset
        }
        return composerOrigin(
            visibleFrame: screen.visibleFrame,
            panelSize: composerContentSize
        ).y
    }

    /// The tallest browser the screen can show above the card's bottom edge
    /// without moving the card or letting the window's top leave the screen.
    func maximumHistoryBrowserHeight(
        mode: ComposerHistoryBrowserMode,
        targetContentBottom: CGFloat? = nil,
        cardHeight: CGFloat? = nil
    ) -> CGFloat {
        guard let screen = window?.screen ?? NSScreen.main else {
            return composerHistoryBrowserPreferredHeight(for: mode)
        }
        return composerHistoryBrowserMaxHeight(
            visibleFrame: screen.visibleFrame,
            contentOrigin: CGPoint(
                x: 0,
                y: contentBottom(for: screen, targetContentBottom: targetContentBottom)
            ),
            cardHeight: cardHeight ?? composerCardHeight(inputHeight: currentInputHeight),
            shadowInset: ComposerMetrics.shadowInset
        )
    }

    /// Whether the browser can show its header, one body line and its footer.
    /// With no screen to measure against (headless tests) it is always allowed.
    func canFitHistoryBrowser(mode: ComposerHistoryBrowserMode) -> Bool {
        guard window?.screen != nil || NSScreen.main != nil else { return true }
        return maximumHistoryBrowserHeight(mode: mode)
            >= composerHistoryBrowserMinimumUsableHeight
    }

    private func desiredHistoryHeight(
        cardHeight: CGFloat,
        targetContentBottom: CGFloat?
    ) -> CGFloat {
        guard !content.historyBrowserView.isHidden else {
            return content.historyView.contentHeight
        }
        let mode: ComposerHistoryBrowserMode = content.historyBrowserView.isZoomed
            ? .zoomed
            : .twoColumn
        let maxHeight = maximumHistoryBrowserHeight(
            mode: mode,
            targetContentBottom: targetContentBottom,
            cardHeight: cardHeight
        )
        return composerHistoryBrowserHeight(maxAvailable: maxHeight, mode: mode)
    }

    /// Applies the input, card and history heights. `targetContentBottom` lets
    /// the caller measure against where the panel is about to be positioned
    /// (screen changes), while a dragged panel measures its real bottom edge.
    /// The completion runs once the current height animation settles.
    func updateInputHeight(
        animated: Bool,
        targetContentBottom: CGFloat? = nil,
        completion: (() -> Void)? = nil
    ) {
        guard let panel = window else {
            completion?()
            return
        }
        let desired = desiredInputHeight()
        let desiredCard = composerCardHeight(inputHeight: desired)
        let desiredSuggestion = desiredHistoryHeight(
            cardHeight: desiredCard,
            targetContentBottom: targetContentBottom
        )
        historyPanelHeight = desiredSuggestion
        updateHistoryPanelVisibility()

        let sizeChanged = abs(desired - currentInputHeight) > 0.5
            || abs(desiredSuggestion - currentSuggestionHeight) > 0.5
        currentInputHeight = desired
        currentSuggestionHeight = desiredSuggestion

        guard sizeChanged else {
            // A no-op update (for example a focus change while the window is
            // already at its target size) must not cancel a pending animation.
            completion?()
            return
        }

        // Only a height that actually changes starts a new animation, and only
        // its completion may restore reading positions.
        heightAnimationGeneration += 1
        let generation = heightAnimationGeneration

        var frame = panel.frame
        frame.size = composerWindowSize
        let apply = {
            self.scrollHeightConstraint?.constant = desired
            self.cardHeightConstraint?.constant = desiredCard
            self.historyHeightConstraint?.constant = desiredSuggestion
        }
        let finish = { [weak self] in
            guard let self, self.heightAnimationGeneration == generation else { return }
            self.content.textView.scrollRangeToVisible(
                self.content.textView.selectedRange()
            )
            completion?()
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
            } completionHandler: {
                finish()
            }
        } else {
            apply()
            panel.setFrame(frame, display: true)
            panel.contentView?.layoutSubtreeIfNeeded()
            finish()
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