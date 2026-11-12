import AppKit
import PanelizeSearchCore

struct ComposerActions {
    let hide: () -> Void
    let submit: () -> Void
    let handleEscape: () -> Void
    let acceptTriggerCompletion: () -> Bool
    let cyclePromptMode: (Bool) -> Void
    let moveHistorySelection: (Int) -> Bool
    let pickHistorySuggestion: (Int) -> Void
    let applyPromptMode: (PromptModeChoice) -> Void
    let toggleNewChat: (Bool) -> Void
    let openBridgeSettings: () -> Void
}

/// Builds the view tree and forwards UI actions without owning send state.
final class ComposerContent: NSObject {
    private var actions: ComposerActions?
    private var isCardHovered = false
    private var cardPulseGeneration = 0
    lazy var layout = ComposerLayoutController(content: self)

    let textView = PromptTextView()
    let scrollView = NSScrollView()
    let placeholder = NSTextField(labelWithString: "输入问题，发送给所有 AI…")
    let statusLabel = NSTextField(labelWithString: "")
    let statusIcon = StatusIconView(frame: .zero)
    let statusStack = StatusStackView()
    let sendButton = SendButton()
    let shortcutHintView = ShortcutHintView(frame: .zero)
    let previewLabel = NSTextField(labelWithString: "")
    let modeHintLabel = NSTextField(labelWithString: "")
    let completionOverlay = PromptCompletionOverlayView(frame: .zero)
    let historyView = PromptHistorySuggestionView(frame: .zero)
    let historyBrowserView = PromptHistoryBrowserView(frame: .zero)
    let newChatCheckbox = NSButton(checkboxWithTitle: "新建会话", target: nil, action: nil)
    let modePicker = ModePickerButton(frame: .zero)
    let rootView = ComposerRootView(frame: .zero)
    let backdrop = ComposerBackdropView()
    let surfaceView = ComposerSurfaceView(frame: .zero)
    let shadowView = ComposerShadowView(frame: .zero)
    let historyPanelShadow = ComposerShadowView(
        cornerRadius: ComposerMetrics.historyPanelCornerRadius,
        shadowRadius: ComposerMetrics.historyPanelShadowRadius
    )
    let historyPanelBackdrop = ComposerBackdropView(
        cornerRadius: ComposerMetrics.historyPanelCornerRadius
    )
    let historyPanelSurface = ComposerSurfaceView(style: .historyPanel)

    @objc private func sendTapped() { actions?.submit() }
    @objc private func openBridgeSettingsFromStatus() { actions?.openBridgeSettings() }
    @objc private func newChatToggled() {
        actions?.toggleNewChat(newChatCheckbox.state == .on)
    }

    func build(in panel: NSWindow, mode: PromptModeChoice, delegate: NSTextViewDelegate, actions: ComposerActions) {
        self.actions = actions
        let inset = ComposerMetrics.shadowInset

        rootView.onOutsideClick = { [weak self] in self?.actions?.hide() }
        panel.contentView = rootView

        // The history panel sits above the card but behind it in the stack, so
        // the card's top edge covers the panel's bottom padding.
        rootView.addSubview(historyPanelShadow)
        rootView.addSubview(historyPanelBackdrop)
        rootView.addSubview(historyPanelSurface)
        rootView.addSubview(historyView)
        rootView.addSubview(historyBrowserView)

        shadowView.translatesAutoresizingMaskIntoConstraints = false
        rootView.addSubview(shadowView)

        backdrop.material = .popover
        backdrop.blendingMode = .behindWindow
        backdrop.state = .active
        backdrop.wantsLayer = true
        backdrop.layer?.cornerRadius = ComposerMetrics.cornerRadius
        backdrop.layer?.cornerCurve = .continuous
        backdrop.layer?.masksToBounds = true
        backdrop.translatesAutoresizingMaskIntoConstraints = false
        rootView.addSubview(backdrop)

        surfaceView.translatesAutoresizingMaskIntoConstraints = false
        surfaceView.onHoverChanged = { [weak self] hovered in
            self?.setCardHovered(hovered)
        }
        rootView.addSubview(surfaceView)

        let content = ComposerContentView()
        content.translatesAutoresizingMaskIntoConstraints = false
        rootView.addSubview(content)

        // The recent-question list is its own panel above the card: separate
        // shadow, material and surface, so it never reads as part of the input.
        historyPanelShadow.translatesAutoresizingMaskIntoConstraints = false

        historyPanelBackdrop.material = .popover
        historyPanelBackdrop.blendingMode = .behindWindow
        historyPanelBackdrop.state = .active
        historyPanelBackdrop.wantsLayer = true
        historyPanelBackdrop.layer?.cornerRadius = ComposerMetrics.historyPanelCornerRadius
        historyPanelBackdrop.layer?.cornerCurve = .continuous
        historyPanelBackdrop.layer?.masksToBounds = true
        historyPanelBackdrop.translatesAutoresizingMaskIntoConstraints = false

        historyPanelSurface.translatesAutoresizingMaskIntoConstraints = false

        rootView.cardViews = [backdrop, historyPanelBackdrop]

        textView.isRichText = false
        textView.allowsUndo = true
        textView.drawsBackground = false
        textView.focusRingType = .none
        textView.font = ComposerFonts.input
        textView.textColor = .labelColor
        textView.insertionPointColor = .labelColor
        textView.textContainerInset = NSSize(width: 2, height: 4)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.lineFragmentPadding = 0
        textView.delegate = delegate
        textView.onEnter = { [weak self] in self?.actions?.submit() }
        textView.onEscape = { [weak self] in self?.actions?.handleEscape() }
        textView.onTabCompletion = { [weak self] in self?.actions?.acceptTriggerCompletion() ?? false }
        textView.onCyclePromptMode = { [weak self] forward in
            self?.actions?.cyclePromptMode(forward)
        }
        textView.onArrowUp = { [weak self] in self?.actions?.moveHistorySelection(-1) ?? false }
        textView.onArrowDown = { [weak self] in self?.actions?.moveHistorySelection(1) ?? false }
        textView.addSubview(completionOverlay)

        historyView.isHidden = true
        historyView.translatesAutoresizingMaskIntoConstraints = false
        historyView.onSelect = { [weak self] index in
            self?.actions?.pickHistorySuggestion(index)
        }

        historyBrowserView.isHidden = true
        historyBrowserView.translatesAutoresizingMaskIntoConstraints = false

        newChatCheckbox.font = ComposerFonts.newChatCheckbox
        newChatCheckbox.controlSize = .small
        newChatCheckbox.target = self
        newChatCheckbox.action = #selector(newChatToggled)
        newChatCheckbox.toolTip = "勾选后每轮发送前为所有 AI 开启新会话"
        newChatCheckbox.setAccessibilityLabel("新建会话")
        newChatCheckbox.setContentHuggingPriority(.required, for: .horizontal)
        newChatCheckbox.setContentCompressionResistancePriority(.required, for: .horizontal)
        newChatCheckbox.translatesAutoresizingMaskIntoConstraints = false

        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.focusRingType = .none
        scrollView.hasVerticalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.documentView = textView
        scrollView.translatesAutoresizingMaskIntoConstraints = false

        placeholder.font = ComposerFonts.input
        placeholder.textColor = .placeholderTextColor
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        placeholder.isEditable = false
        placeholder.isSelectable = false
        placeholder.isBordered = false
        placeholder.drawsBackground = false

        statusIcon.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = ComposerFonts.status
        statusLabel.lineBreakMode = .byTruncatingTail
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.textColor = .secondaryLabelColor

        previewLabel.font = ComposerFonts.preview
        previewLabel.textColor = .tertiaryLabelColor
        previewLabel.lineBreakMode = .byTruncatingTail
        previewLabel.maximumNumberOfLines = 1
        previewLabel.usesSingleLineMode = true
        previewLabel.isEditable = false
        previewLabel.isSelectable = false
        previewLabel.isBordered = false
        previewLabel.drawsBackground = false
        previewLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        previewLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)
        previewLabel.setAccessibilityElement(false)
        previewLabel.translatesAutoresizingMaskIntoConstraints = false
        previewLabel.isHidden = true

        modeHintLabel.font = ComposerFonts.modeHint
        modeHintLabel.textColor = ComposerTheme.previewColor(increaseContrast: false)
        modeHintLabel.lineBreakMode = .byTruncatingTail
        modeHintLabel.maximumNumberOfLines = 1
        modeHintLabel.usesSingleLineMode = true
        modeHintLabel.isEditable = false
        modeHintLabel.isSelectable = false
        modeHintLabel.isBordered = false
        modeHintLabel.drawsBackground = false
        modeHintLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        modeHintLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)
        modeHintLabel.setAccessibilityElement(true)
        modeHintLabel.setAccessibilityRole(.staticText)
        modeHintLabel.setAccessibilityLabel("提示词模式说明")
        modeHintLabel.translatesAutoresizingMaskIntoConstraints = false

        modePicker.onSelect = { [weak self] choice in
            self?.actions?.applyPromptMode(choice)
        }
        modePicker.select(mode)
        updateModeHint(for: mode)
        modePicker.translatesAutoresizingMaskIntoConstraints = false

        let sendImage = NSImage(
            systemSymbolName: "arrow.up",
            accessibilityDescription: "发送给所有 AI"
        )?.withSymbolConfiguration(
            NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
        )
        sendButton.normalImage = sendImage
        sendButton.setContentHuggingPriority(.required, for: .horizontal)
        sendButton.setContentCompressionResistancePriority(.required, for: .horizontal)
        sendButton.isBordered = false
        sendButton.wantsLayer = true
        sendButton.target = self
        sendButton.action = #selector(sendTapped)
        sendButton.translatesAutoresizingMaskIntoConstraints = false
        sendButton.toolTip = "发送给所有 AI（Enter）"

        shortcutHintView.translatesAutoresizingMaskIntoConstraints = false

        statusStack.addArrangedSubview(statusIcon)
        statusStack.addArrangedSubview(statusLabel)
        statusStack.orientation = .horizontal
        statusStack.spacing = 6
        statusStack.alignment = .centerY
        statusStack.detachesHiddenViews = true
        statusStack.addGestureRecognizer(
            NSClickGestureRecognizer(target: self, action: #selector(openBridgeSettingsFromStatus))
        )
        statusStack.translatesAutoresizingMaskIntoConstraints = false

        modePicker.setContentHuggingPriority(.required, for: .horizontal)
        modePicker.setContentCompressionResistancePriority(.required, for: .horizontal)
        statusStack.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        statusLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let footerLeft = NSStackView(views: [statusStack, modePicker, newChatCheckbox])
        footerLeft.orientation = .horizontal
        footerLeft.spacing = 10
        footerLeft.alignment = .centerY
        footerLeft.translatesAutoresizingMaskIntoConstraints = false

        let footerRight = NSStackView(views: [shortcutHintView, sendButton])
        footerRight.orientation = .horizontal
        footerRight.spacing = 10
        footerRight.alignment = .centerY
        footerRight.translatesAutoresizingMaskIntoConstraints = false
        shortcutHintView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let footer = ComposerContentView()
        footer.translatesAutoresizingMaskIntoConstraints = false
        footer.addSubview(footerLeft)
        footer.addSubview(footerRight)
        footer.addSubview(modeHintLabel)

        content.addSubview(scrollView)
        content.addSubview(placeholder)
        content.addSubview(previewLabel)
        content.addSubview(footer)

        let scrollHeight = scrollView.heightAnchor.constraint(
            equalToConstant: ComposerMetrics.baseInputHeight
        )
        let cardHeight = backdrop.heightAnchor.constraint(
            equalToConstant: composerCardHeight(inputHeight: layout.currentInputHeight)
        )
        let historyHeight = historyPanelBackdrop.heightAnchor.constraint(equalToConstant: 0)
        layout.bind(scroll: scrollHeight, card: cardHeight, history: historyHeight)

        NSLayoutConstraint.activate([
            shadowView.leadingAnchor.constraint(equalTo: backdrop.leadingAnchor),
            shadowView.trailingAnchor.constraint(equalTo: backdrop.trailingAnchor),
            shadowView.topAnchor.constraint(equalTo: backdrop.topAnchor),
            shadowView.bottomAnchor.constraint(equalTo: backdrop.bottomAnchor),

            backdrop.leadingAnchor.constraint(equalTo: rootView.leadingAnchor, constant: inset),
            backdrop.trailingAnchor.constraint(equalTo: rootView.trailingAnchor, constant: -inset),
            backdrop.bottomAnchor.constraint(equalTo: rootView.bottomAnchor, constant: -inset),
            cardHeight,

            surfaceView.leadingAnchor.constraint(equalTo: backdrop.leadingAnchor),
            surfaceView.trailingAnchor.constraint(equalTo: backdrop.trailingAnchor),
            surfaceView.topAnchor.constraint(equalTo: backdrop.topAnchor),
            surfaceView.bottomAnchor.constraint(equalTo: backdrop.bottomAnchor),

            historyPanelBackdrop.leadingAnchor.constraint(
                equalTo: backdrop.leadingAnchor,
                constant: ComposerMetrics.historyPanelSideInset
            ),
            historyPanelBackdrop.trailingAnchor.constraint(
                equalTo: backdrop.trailingAnchor,
                constant: -ComposerMetrics.historyPanelSideInset
            ),
            // Tuck the panel's bottom padding behind the card so the two read as one
            // stack, with the input card in front.
            historyPanelBackdrop.bottomAnchor.constraint(
                equalTo: backdrop.topAnchor,
                constant: composerHistoryPanelOverlap
            ),
            historyHeight,

            historyPanelShadow.leadingAnchor.constraint(equalTo: historyPanelBackdrop.leadingAnchor),
            historyPanelShadow.trailingAnchor.constraint(equalTo: historyPanelBackdrop.trailingAnchor),
            historyPanelShadow.topAnchor.constraint(equalTo: historyPanelBackdrop.topAnchor),
            historyPanelShadow.bottomAnchor.constraint(equalTo: historyPanelBackdrop.bottomAnchor),

            historyPanelSurface.leadingAnchor.constraint(equalTo: historyPanelBackdrop.leadingAnchor),
            historyPanelSurface.trailingAnchor.constraint(equalTo: historyPanelBackdrop.trailingAnchor),
            historyPanelSurface.topAnchor.constraint(equalTo: historyPanelBackdrop.topAnchor),
            historyPanelSurface.bottomAnchor.constraint(equalTo: historyPanelBackdrop.bottomAnchor),

            historyView.leadingAnchor.constraint(equalTo: historyPanelBackdrop.leadingAnchor),
            historyView.trailingAnchor.constraint(equalTo: historyPanelBackdrop.trailingAnchor),
            historyView.topAnchor.constraint(equalTo: historyPanelBackdrop.topAnchor),
            historyView.bottomAnchor.constraint(equalTo: historyPanelBackdrop.bottomAnchor),

            historyBrowserView.leadingAnchor.constraint(equalTo: historyPanelBackdrop.leadingAnchor),
            historyBrowserView.trailingAnchor.constraint(equalTo: historyPanelBackdrop.trailingAnchor),
            historyBrowserView.topAnchor.constraint(equalTo: historyPanelBackdrop.topAnchor),
            historyBrowserView.bottomAnchor.constraint(equalTo: historyPanelBackdrop.bottomAnchor),

            content.leadingAnchor.constraint(
                equalTo: backdrop.leadingAnchor,
                constant: ComposerMetrics.contentInsetLeft
            ),
            content.trailingAnchor.constraint(
                equalTo: backdrop.trailingAnchor,
                constant: -ComposerMetrics.contentInsetRight
            ),
            content.topAnchor.constraint(
                equalTo: backdrop.topAnchor,
                constant: ComposerMetrics.contentInsetTop
            ),
            content.bottomAnchor.constraint(
                equalTo: backdrop.bottomAnchor,
                constant: -ComposerMetrics.contentInsetBottom
            ),

            scrollView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: content.topAnchor),
            scrollHeight,

            placeholder.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 2),
            placeholder.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 6),

            previewLabel.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 2),
            previewLabel.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor),
            previewLabel.topAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: 4),
            previewLabel.bottomAnchor.constraint(lessThanOrEqualTo: footer.topAnchor, constant: -4),

            footer.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            footer.heightAnchor.constraint(equalToConstant: ComposerMetrics.footerHeight),

            statusIcon.widthAnchor.constraint(equalToConstant: ComposerMetrics.statusIconSize),
            statusIcon.heightAnchor.constraint(equalToConstant: ComposerMetrics.statusIconSize),
            footerLeft.leadingAnchor.constraint(equalTo: footer.leadingAnchor),
            footerLeft.topAnchor.constraint(equalTo: footer.topAnchor, constant: 4),
            footerLeft.trailingAnchor.constraint(
                lessThanOrEqualTo: footerRight.leadingAnchor,
                constant: -10
            ),

            footerRight.trailingAnchor.constraint(equalTo: footer.trailingAnchor),
            footerRight.centerYAnchor.constraint(equalTo: modePicker.centerYAnchor),

            modeHintLabel.leadingAnchor.constraint(equalTo: modePicker.leadingAnchor),
            modeHintLabel.topAnchor.constraint(
                equalTo: modePicker.bottomAnchor,
                constant: ComposerMetrics.modeHintSpacing
            ),
            modeHintLabel.heightAnchor.constraint(equalToConstant: ComposerMetrics.modeHintHeight),
            modeHintLabel.trailingAnchor.constraint(
                lessThanOrEqualTo: footerRight.leadingAnchor,
                constant: -10
            ),

            modePicker.heightAnchor.constraint(equalToConstant: ComposerMetrics.modePickerHeight),

            sendButton.widthAnchor.constraint(equalToConstant: ComposerMetrics.sendButtonSize),
            sendButton.heightAnchor.constraint(equalToConstant: ComposerMetrics.sendButtonSize)
        ])

        sendButton.refreshAppearance()
        modePicker.refreshAppearance()
        shortcutHintView.refreshAppearance()
        textView.frame = scrollView.contentView.bounds
    }

    /// Shows the selected mode's explanation below the picker by default.
    func updateModeHint(for choice: PromptModeChoice) {
        let hint = choice.hint(in: .current)
        modeHintLabel.stringValue = hint
        modeHintLabel.toolTip = hint.isEmpty ? nil : hint
        modeHintLabel.setAccessibilityValue(hint)
        modeHintLabel.isHidden = hint.isEmpty
    }

    /// Hover/focus emphasis on the card: a slightly stronger edge and a
    /// deeper shadow, animated so it reads as the same control reacting.
    func setCardHovered(_ hovered: Bool, animated: Bool = true) {
        guard isCardHovered != hovered else { return }
        isCardHovered = hovered
        applyCardEmphasis(hovered, animated: animated)
    }

    /// Mirrors the extension's focus sweep: emphasize briefly, then settle
    /// back to the current hover state.
    func pulseCardFocus() {
        guard !ComposerAccessibilityOptions.current.reduceMotion else { return }
        cardPulseGeneration += 1
        let generation = cardPulseGeneration
        applyCardEmphasis(true, animated: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.14) { [weak self] in
            guard let self, self.cardPulseGeneration == generation else { return }
            self.applyCardEmphasis(self.isCardHovered, animated: true)
        }
    }

    private func applyCardEmphasis(_ emphasized: Bool, animated: Bool) {
        backdrop.setEmphasized(emphasized, animated: animated)
        surfaceView.setEmphasized(emphasized, animated: animated)
        shadowView.setEmphasized(emphasized, animated: animated)
    }

    func applyAccessibilityOptions() {
        let options = ComposerAccessibilityOptions.current
        backdrop.isHidden = options.reduceTransparency
        backdrop.refreshAppearance()
        surfaceView.refreshAppearance()
        shadowView.refreshAppearance()
        historyPanelBackdrop.refreshAppearance()
        historyPanelSurface.refreshAppearance()
        historyPanelShadow.refreshAppearance()
        layout.updateHistoryPanelVisibility()
        previewLabel.textColor = ComposerTheme.previewColor(
            increaseContrast: options.increaseContrast
        )
        modeHintLabel.textColor = ComposerTheme.previewColor(
            increaseContrast: options.increaseContrast
        )
        shortcutHintView.refreshAppearance()
        modePicker.refreshAppearance()
        sendButton.refreshAppearance()
        completionOverlay.needsDisplay = true
        historyBrowserView.needsDisplay = true
    }
}
