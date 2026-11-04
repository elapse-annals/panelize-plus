import AppKit
import PanelizeSearchCore

final class SearchPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class PromptTextView: NSTextView {
    var onEnter: (() -> Void)?
    var onEscape: (() -> Void)?
    var onTabCompletion: (() -> Bool)?
    var onCyclePromptMode: ((_ forward: Bool) -> Void)?
    var onArrowUp: (() -> Bool)?
    var onArrowDown: (() -> Bool)?

    /// Standard editing shortcuts also work without an Edit menu, which keeps
    /// the accessory app's menu bar optional while the composer is visible.
    @objc func undo(_ sender: Any?) {
        undoManager?.undo()
    }

    @objc func redo(_ sender: Any?) {
        undoManager?.redo()
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
        guard let key = event.charactersIgnoringModifiers?.lowercased() else {
            return super.performKeyEquivalent(with: event)
        }
        if flags == .command {
            switch key {
            case "a":
                selectAll(nil)
                return true
            case "c":
                copy(nil)
                return true
            case "v":
                paste(nil)
                return true
            case "x":
                cut(nil)
                return true
            case "z":
                undoManager?.undo()
                return true
            default:
                break
            }
        } else if flags == [.command, .shift], key == "z" {
            undoManager?.redo()
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    override func keyDown(with event: NSEvent) {
        // The history list above the input takes the arrows while it shows.
        if (event.keyCode == 126 || event.keyCode == 125),
           event.modifierFlags.intersection([.shift, .control, .option, .command]).isEmpty,
           !hasMarkedText() {
            let handled = event.keyCode == 126 ? onArrowUp?() : onArrowDown?()
            if handled == true {
                return
            }
        }

        if event.keyCode == 48,
           event.modifierFlags.intersection([.control, .option, .command]).isEmpty,
           !hasMarkedText() {
            // An inline trigger completion wins. Otherwise Tab cycles the
            // prompt mode only while the input is empty, Shift+Tab backwards;
            // with text present it leaves the prompt untouched.
            let shift = event.modifierFlags.contains(.shift)
            if !shift, onTabCompletion?() == true {
                return
            }
            if string.isEmpty {
                onCyclePromptMode?(!shift)
            }
            return
        }

        if event.keyCode == 53,
           !event.modifierFlags.contains(.shift),
           !hasMarkedText() {
            onEscape?()
            return
        }

        if event.keyCode == 36 || event.keyCode == 76 {
            if event.modifierFlags.contains(.shift) || hasMarkedText() {
                super.keyDown(with: event)
                return
            }
            onEnter?()
            return
        }

        super.keyDown(with: event)
    }

    /// The insertion point in the text view's own coordinates. Unlike
    /// firstRect(forCharacterRange:) this is explicit for empty text and the
    /// character after the last glyph, and needs no screen conversion.
    func caretRect(forCharacterIndex index: Int) -> NSRect? {
        guard let layoutManager, let textContainer else { return nil }
        layoutManager.ensureLayout(for: textContainer)

        let text = string as NSString
        let caret = min(max(0, index), text.length)
        let origin = textContainerOrigin
        let lineHeight = layoutManager.defaultLineHeight(
            for: font ?? .systemFont(ofSize: 20, weight: .regular)
        )

        guard text.length > 0 else {
            return NSRect(x: origin.x, y: origin.y, width: 2, height: lineHeight)
        }

        if caret >= text.length {
            let lastCharacter = NSRange(location: text.length - 1, length: 1)
            let lastGlyphs = layoutManager.glyphRange(
                forCharacterRange: lastCharacter,
                actualCharacterRange: nil
            )
            let glyph = max(0, NSMaxRange(lastGlyphs) - 1)
            let line = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
            let glyphRect = layoutManager.boundingRect(forGlyphRange: lastGlyphs, in: textContainer)
            return NSRect(
                x: origin.x + glyphRect.maxX,
                y: origin.y + line.minY,
                width: 2,
                height: line.height
            )
        }

        let glyph = layoutManager.glyphIndexForCharacter(at: caret)
        let line = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        let location = layoutManager.location(forGlyphAt: glyph)
        return NSRect(
            x: origin.x + location.x,
            y: origin.y + line.minY,
            width: 2,
            height: line.height
        )
    }
}

private final class StatusStackView: NSStackView {
    var isActionable = false {
        didSet {
            guard oldValue != isActionable else { return }
            window?.invalidateCursorRects(for: self)
        }
    }

    override func resetCursorRects() {
        super.resetCursorRects()
        if isActionable {
            addCursorRect(bounds, cursor: .pointingHand)
        }
    }
}

private final class SendButton: NSButton {
    var isBusy = false {
        didSet { refreshAppearance() }
    }

    var normalImage: NSImage? {
        didSet {
            arrowView.image = normalImage
            refreshAppearance()
        }
    }

    private let spinner = NSProgressIndicator()
    private let arrowView = NSImageView()
    private var isHovered = false
    private var isPressed = false
    private var trackingArea: NSTrackingArea?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        isBordered = false
        title = ""
        alternateTitle = ""
        wantsLayer = true
        focusRingType = .none
        layer?.masksToBounds = true

        arrowView.imageScaling = .scaleProportionallyUpOrDown
        arrowView.translatesAutoresizingMaskIntoConstraints = false
        arrowView.setAccessibilityElement(false)
        arrowView.isHidden = true
        addSubview(arrowView)

        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        spinner.setAccessibilityElement(false)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        addSubview(spinner)

        NSLayoutConstraint.activate([
            arrowView.centerXAnchor.constraint(equalTo: centerXAnchor),
            arrowView.centerYAnchor.constraint(equalTo: centerYAnchor),
            arrowView.widthAnchor.constraint(equalToConstant: 14),
            arrowView.heightAnchor.constraint(equalToConstant: 14),
            spinner.centerXAnchor.constraint(equalTo: centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: centerYAnchor),
            spinner.widthAnchor.constraint(equalToConstant: ComposerMetrics.progressSize),
            spinner.heightAnchor.constraint(equalToConstant: ComposerMetrics.progressSize)
        ])
        spinner.isHidden = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func updateLayer() {
        super.updateLayer()
        refreshAppearance()
    }

    override func layout() {
        super.layout()
        layer?.cornerRadius = bounds.height / 2
        layer?.masksToBounds = true
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        refreshAppearance()
    }

    /// The arrow and spinner are decoration; every click belongs to the
    /// button so the action never depends on which subview was hit.
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        return bounds.contains(local) ? self : nil
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea {
            removeTrackingArea(trackingArea)
        }
        let area = NSTrackingArea(
            rect: .zero,
            options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        isHovered = true
        refreshAppearance()
    }

    override func mouseExited(with event: NSEvent) {
        isHovered = false
        isPressed = false
        refreshAppearance()
    }

    override func mouseDown(with event: NSEvent) {
        isPressed = true
        refreshAppearance()
        super.mouseDown(with: event)
        isPressed = false
        refreshAppearance()
    }

    func refreshAppearance() {
        wantsLayer = true
        layer?.cornerRadius = bounds.height / 2
        layer?.masksToBounds = true
        let options = ComposerAccessibilityOptions.current
        let active = isEnabled && !isBusy
        let background: NSColor
        if active {
            let accent = NSColor.controlAccentColor
            if isPressed {
                background = accent.blended(withFraction: 0.18, of: .black) ?? accent
            } else if isHovered {
                background = accent.blended(withFraction: 0.10, of: .black) ?? accent
            } else {
                background = accent
            }
        } else {
            background = .quaternaryLabelColor
        }
        layer?.backgroundColor = ComposerTheme.resolve(
            background,
            in: effectiveAppearance
        )
        alphaValue = isBusy ? 0.90 : 1

        if isBusy {
            if options.reduceMotion {
                spinner.stopAnimation(nil)
                spinner.isHidden = true
                arrowView.isHidden = false
                arrowView.image = NSImage(
                    systemSymbolName: "ellipsis",
                    accessibilityDescription: nil
                )?.withSymbolConfiguration(
                    NSImage.SymbolConfiguration(pointSize: 11, weight: .semibold)
                )
                arrowView.contentTintColor = .tertiaryLabelColor
            } else {
                arrowView.isHidden = true
                spinner.isHidden = false
                spinner.startAnimation(nil)
            }
            setAccessibilityLabel("正在发送…")
            toolTip = "正在发送…"
        } else {
            spinner.stopAnimation(nil)
            spinner.isHidden = true
            arrowView.isHidden = false
            arrowView.image = normalImage
            arrowView.contentTintColor = active ? .white : .tertiaryLabelColor
            setAccessibilityLabel("发送给所有 AI")
            toolTip = "发送给所有 AI（Enter）"
        }
    }
}

private final class ComposerBackdropView: NSVisualEffectView {
    private let cornerRadius: CGFloat

    init(frame frameRect: NSRect = .zero, cornerRadius: CGFloat = ComposerMetrics.cornerRadius) {
        self.cornerRadius = cornerRadius
        super.init(frame: frameRect)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        updateBorder()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        updateBorder()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        updateBorder()
    }

    func refreshAppearance() {
        updateBorder()
    }

    override var mouseDownCanMoveWindow: Bool { true }

    private func updateBorder() {
        wantsLayer = true
        layer?.cornerRadius = cornerRadius
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true
        layer?.borderWidth = 1 / (window?.backingScaleFactor ?? 2)

        let options = ComposerAccessibilityOptions.current
        layer?.borderColor = ComposerTheme.resolve(
            ComposerTheme.borderColor(
                in: effectiveAppearance,
                increaseContrast: options.increaseContrast
            ),
            in: effectiveAppearance
        )
    }
}

final class SearchPanelController: NSWindowController, NSTextViewDelegate, NSWindowDelegate {
    private let bridge: BridgeServer
    private let textView = PromptTextView()
    private let scrollView = NSScrollView()
    private let placeholder = NSTextField(labelWithString: "输入问题，发送给所有 AI…")
    private let statusLabel = NSTextField(labelWithString: "")
    private let statusIcon = StatusIconView(frame: .zero)
    private let statusStack = StatusStackView()
    private let sendButton = SendButton()
    private let shortcutHintView = ShortcutHintView(frame: .zero)
    private let previewLabel = NSTextField(labelWithString: "")
    private let completionOverlay = PromptCompletionOverlayView(frame: .zero)
    private var currentCompletion: PromptTriggerCompletion?
    private let historyView = PromptHistorySuggestionView(frame: .zero)
    private let historyStore = PromptHistoryStore()
    private var historyMatches: [String] = []
    private var historySelection: Int?
    private var historyHeightConstraint: NSLayoutConstraint?
    private var currentSuggestionHeight: CGFloat = 0
    private var suppressHistory = false
    private var lastSubmittedText: String?
    private let modePicker = ModePickerButton(frame: .zero)
    private var selectedPromptMode = PromptModeChoice.load()
    private var isSending = false
    private var connectionReady = false
    private var autoHideWorkItem: DispatchWorkItem?
    private var didForceRegular = false
    private var currentConnectionText = "浏览器未连接"

    private let rootView = ComposerRootView(frame: .zero)
    private let backdrop = ComposerBackdropView()
    private let surfaceView = ComposerSurfaceView(frame: .zero)
    private let shadowView = ComposerShadowView(frame: .zero)
    private let historyPanelShadow = ComposerShadowView(
        cornerRadius: ComposerMetrics.historyPanelCornerRadius,
        shadowRadius: ComposerMetrics.historyPanelShadowRadius
    )
    private let historyPanelBackdrop = ComposerBackdropView(
        cornerRadius: ComposerMetrics.historyPanelCornerRadius
    )
    private let historyPanelSurface = ComposerSurfaceView(style: .historyPanel)
    private var scrollHeightConstraint: NSLayoutConstraint?
    private var cardHeightConstraint: NSLayoutConstraint?
    private var historyPanelHeight: CGFloat = 0
    private var currentInputHeight = ComposerMetrics.baseInputHeight
    private var hideGeneration = 0
    private var isHiding = false
    private var accessibilityObserver: NSObjectProtocol?

    /// Opens the extension settings at the global-input bridge switch. Returns
    /// false when the native host manifest is missing.
    var onOpenBridgeSettings: (() -> Bool)?
    private var globalClickMonitor: Any?
    private var appResignObserver: NSObjectProtocol?
    private var shownAt = Date.distantPast

    private var composerContentSize: CGSize {
        CGSize(
            width: ComposerMetrics.contentWidth,
            height: composerContentHeight(
                inputHeight: currentInputHeight,
                suggestionHeight: currentSuggestionHeight
            )
        )
    }

    private var composerWindowSize: CGSize {
        CGSize(
            width: composerContentSize.width + ComposerMetrics.shadowInset * 2,
            height: composerContentSize.height + ComposerMetrics.shadowInset * 2
        )
    }

    init(bridge: BridgeServer) {
        self.bridge = bridge
        let inset = ComposerMetrics.shadowInset
        let panel = SearchPanel(
            contentRect: NSRect(
                x: 0,
                y: 0,
                width: ComposerMetrics.contentWidth + inset * 2,
                height: ComposerMetrics.baseContentHeight + inset * 2
            ),
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.hasShadow = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        super.init(window: panel)
        panel.delegate = self
        setupContent()
        updateConnection(label: currentConnectionText, ready: false)
        accessibilityObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.applyAccessibilityOptions()
        }
        applyAccessibilityOptions()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        stopDismissMonitoring()
        if let accessibilityObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(accessibilityObserver)
        }
    }

    func setConnectionStatus(_ text: String, ready: Bool) {
        currentConnectionText = text
        connectionReady = ready
        updateConnection(label: text, ready: ready)
    }

    func toggle() {
        guard let panel = window else { return }
        if panel.isVisible && !isHiding {
            hide()
        } else {
            show()
        }
    }

    func show() {
        guard let panel = window else {
            return
        }
        hideGeneration += 1
        isHiding = false
        autoHideWorkItem?.cancel()

        // Restore the height needed by any text left from a previous session
        // before positioning the panel, including history suggestions.
        suppressHistory = false
        refreshHistorySuggestions()
        updateInputHeight(animated: false)

        // NSScreen.main follows the key window, which can be on another
        // display when the shortcut fires. Show on the display with the mouse.
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first {
            NSMouseInRect(mouse, $0.frame, false)
        } ?? NSScreen.main ?? NSScreen.screens.first
        guard let screen else { return }
        let visible = screen.visibleFrame
        let targetOrigin = composerWindowOrigin(
            visibleFrame: visible,
            contentSize: composerContentSize,
            shadowInset: ComposerMetrics.shadowInset
        )
        let targetFrame = CGRect(origin: targetOrigin, size: composerWindowSize)

        // Accessory apps cannot reliably take activation from the foreground
        // app on newer macOS versions. Stay regular while the composer is
        // visible so Enter and typing always reach it; hide() returns to a
        // menu-bar-only app.
        if !didForceRegular {
            didForceRegular = true
            NSApp.setActivationPolicy(.regular)
        }
        _ = NSRunningApplication.current.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
        NSApp.activate(ignoringOtherApps: true)

        if ComposerAccessibilityOptions.current.reduceMotion {
            panel.alphaValue = 1
            panel.setFrame(targetFrame, display: false)
        } else {
            var startFrame = targetFrame
            startFrame.origin.y -= 6
            panel.alphaValue = 0
            panel.setFrame(startFrame, display: false)
        }
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()

        if !ComposerAccessibilityOptions.current.reduceMotion {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.18
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().alphaValue = 1
                panel.animator().setFrame(targetFrame, display: true)
            }
        }

        if !isSending {
            updateConnection(label: currentConnectionText, ready: connectionReady)
        }
        refreshPromptPreview()
        panel.makeFirstResponder(textView)
        refreshCompletionOverlay()
        startDismissMonitoring()
    }

    func repositionForScreenChanges() {
        guard let panel = window,
              panel.isVisible,
              let screen = panel.screen ?? NSScreen.main else { return }
        let origin = composerWindowOrigin(
            visibleFrame: screen.visibleFrame,
            contentSize: composerContentSize,
            shadowInset: ComposerMetrics.shadowInset
        )
        var frame = panel.frame
        frame.origin = origin
        frame.size = composerWindowSize
        panel.setFrame(frame, display: true)
    }

    func hide() {
        guard let panel = window else { return }
        autoHideWorkItem?.cancel()
        autoHideWorkItem = nil
        stopDismissMonitoring()
        currentCompletion = nil
        completionOverlay.dismiss()

        hideGeneration += 1
        let generation = hideGeneration
        isHiding = true
        let finish = { [weak self, weak panel] in
            guard let self, let panel, self.hideGeneration == generation else { return }
            self.isHiding = false
            panel.orderOut(nil)
            panel.alphaValue = 1
            if self.didForceRegular {
                self.didForceRegular = false
                NSApp.setActivationPolicy(.accessory)
            }
        }

        guard panel.isVisible, !ComposerAccessibilityOptions.current.reduceMotion else {
            finish()
            return
        }

        var target = panel.frame
        target.origin.y -= 4
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.12
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().alphaValue = 0
            panel.animator().setFrame(target, display: true)
        } completionHandler: {
            finish()
        }
    }

    func windowDidResignKey(_ notification: Notification) {
        // Keep the composer on screen when macOS declines to activate an
        // accessory app from the hotkey. Escape, the shortcut and a successful
        // send all dismiss it; losing key focus alone should not.
    }

    private func startDismissMonitoring() {
        guard globalClickMonitor == nil else { return }
        shownAt = Date()

        // Global monitors only receive events delivered to other apps, so
        // clicks inside the panel, its popup and its buttons never dismiss it.
        globalClickMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        ) { [weak self] _ in
            DispatchQueue.main.async {
                self?.dismissForOutsideInteraction()
            }
        }

        // Fallback for the first click that activates another app, which some
        // macOS versions do not deliver to global mouse monitors.
        appResignObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didResignActiveNotification,
            object: NSApp,
            queue: .main
        ) { [weak self] _ in
            self?.dismissForOutsideInteraction()
        }
    }

    private func stopDismissMonitoring() {
        if let globalClickMonitor {
            NSEvent.removeMonitor(globalClickMonitor)
            self.globalClickMonitor = nil
        }
        if let appResignObserver {
            NotificationCenter.default.removeObserver(appResignObserver)
            self.appResignObserver = nil
        }
    }

    private func dismissForOutsideInteraction() {
        guard let panel = window, panel.isVisible else { return }
        guard Date().timeIntervalSince(shownAt) > 0.15 else { return }
        // Clicking an input-method candidate window is not an outside click.
        guard !textView.hasMarkedText() else { return }
        hide()
    }

    func textDidChange(_ notification: Notification) {
        placeholder.isHidden = !textView.string.isEmpty
        suppressHistory = false
        refreshPromptPreview()
        refreshCompletionOverlay()
        refreshHistorySuggestions()
        updateInputHeight(animated: true)
    }

    func textViewDidChangeSelection(_ notification: Notification) {
        refreshCompletionOverlay()
        refreshHistorySuggestions()
        updateInputHeight(animated: false)
    }

    func textDidBeginEditing(_ notification: Notification) {
        refreshCompletionOverlay()
        refreshHistorySuggestions()
        updateInputHeight(animated: false)
    }

    func textDidEndEditing(_ notification: Notification) {
        currentCompletion = nil
        completionOverlay.dismiss()
        clearHistorySuggestions()
        updateInputHeight(animated: false)
    }

    @objc private func sendTapped() {
        submit()
    }

    private func submit() {
        guard !isSending else { return }
        // Enter on a highlighted suggestion fills it instead of sending.
        if acceptSelectedHistory() { return }
        autoHideWorkItem?.cancel()

        let normalized: String
        switch PromptInput.normalized(textView.string) {
        case .failure(.empty):
            showStatus("请输入要发送的内容", color: .systemOrange)
            return
        case .failure(.tooLong):
            showStatus("内容过长（最多 \(BridgeProtocol.maxPromptCharacters) 字符）", color: .systemRed)
            return
        case .success(let value):
            normalized = value
        }

        let text = textView.string
        lastSubmittedText = normalized
        isSending = true
        setBusy(true)
        showStatus("正在发送…", color: .systemBlue)

        let started = bridge.sendPrompt(text, promptMode: selectedPromptMode) { [weak self] update in
            guard let self else { return }
            switch update {
            case .accepted:
                self.showStatus("等待 AI 接收…", color: .systemBlue)
            case .failed(let message):
                self.isSending = false
                self.setBusy(false)
                self.showStatus(message, color: .systemRed)
            case .succeeded(let outcome):
                self.isSending = false
                self.setBusy(false)
                self.handleSuccess(outcome)
            }
        }

        if !started {
            isSending = false
            setBusy(false)
        }
    }

    private func handleSuccess(_ outcome: SendOutcome) {
        guard outcome.ok, outcome.sent > 0 else {
            showStatus(BridgeMessages.errorReason(outcome.reason), color: .systemRed)
            return
        }

        let status = outcome.sent < outcome.total
            ? "已发送至 \(outcome.sent)/\(outcome.total) 个 AI（其余未就绪）"
            : "已发送至 \(outcome.sent) 个 AI"
        showStatus(status, color: .systemGreen)
        if let prompt = lastSubmittedText {
            historyStore.record(prompt)
        }
        lastSubmittedText = nil
        suppressHistory = true
        clearHistorySuggestions()
        textView.string = ""
        placeholder.isHidden = false
        updateInputHeight(animated: true)
        refreshPromptPreview()
        refreshCompletionOverlay()

        // The result means the ready AIs have the prompt; bring their browser
        // forward so the answers are in view.
        activateConnectedBrowser()

        let workItem = DispatchWorkItem { [weak self] in
            self?.hide()
        }
        autoHideWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.15, execute: workItem)
    }

    /// Activates the browser app that hosts the native bridge, if the host
    /// reported one. Activating the app also raises the Multi-Panel window.
    private func activateConnectedBrowser() {
        guard let bundleIdentifier = bridge.connectedBrowserBundleIdentifier,
              let application = NSRunningApplication.runningApplications(
                  withBundleIdentifier: bundleIdentifier
              ).first else {
            return
        }
        _ = application.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
    }

    private func setBusy(_ busy: Bool) {
        textView.isEditable = !busy
        sendButton.isEnabled = !busy
        sendButton.isBusy = busy
        modePicker.isEnabled = !busy
        if busy {
            currentCompletion = nil
            completionOverlay.dismiss()
            suppressHistory = true
            clearHistorySuggestions()
            updateInputHeight(animated: false)
        } else {
            refreshCompletionOverlay()
            refreshHistorySuggestions()
            updateInputHeight(animated: false)
        }
    }

    private func updateConnection(label: String, ready: Bool) {
        guard !isSending else { return }
        if ready {
            statusIcon.update(
                symbolName: "checkmark.circle.fill",
                color: .systemGreen,
                accessibilityLabel: "Panelize 已连接"
            )
            statusLabel.stringValue = ""
            statusLabel.isHidden = true
        } else {
            let short = shortConnectionText(label)
            statusIcon.update(
                symbolName: "exclamationmark.circle.fill",
                color: .systemOrange,
                accessibilityLabel: nil
            )
            statusLabel.isHidden = false
            statusLabel.stringValue = short
            statusLabel.textColor = .systemOrange
        }
        refreshStatusInteraction()
    }

    private func shortConnectionText(_ label: String) -> String {
        if label.contains("等待扩展") { return "等待扩展" }
        if label.contains("启动失败") { return "桥启动失败" }
        if label.contains("未连接") { return "未连接" }
        return label
    }

    private func showStatus(_ text: String, color: NSColor) {
        if statusLabel.stringValue != text {
            crossfade(statusLabel)
        }
        statusLabel.isHidden = false
        statusLabel.stringValue = text
        statusLabel.textColor = color
        statusIcon.update(
            symbolName: statusSymbol(for: color),
            color: color,
            accessibilityLabel: nil
        )
        refreshStatusInteraction()
    }

    private func statusSymbol(for color: NSColor) -> String {
        if color == .systemGreen {
            return "checkmark.circle.fill"
        }
        if color == .systemRed {
            return "xmark.circle.fill"
        }
        if color == .systemBlue {
            return "arrow.up.circle.fill"
        }
        if color == .systemOrange {
            return "exclamationmark.circle.fill"
        }
        return "circle.fill"
    }

    /// Only a real connection problem should take the click; transient send
    /// results keep the footer read-only.
    private var canOpenBridgeSettings: Bool {
        guard !isSending, !connectionReady else { return false }
        let text = statusLabel.stringValue
        return text.contains("未连接") || text.contains("等待扩展")
    }

    private func refreshStatusInteraction() {
        let actionable = canOpenBridgeSettings
        statusStack.isActionable = actionable
        let help = "打开扩展设置，开启「启用全局输入桥接」"
        statusLabel.toolTip = actionable ? help : nil
        statusLabel.setAccessibilityRole(actionable ? .button : .staticText)
        statusLabel.setAccessibilityHelp(actionable ? help : nil)
    }

    @objc private func openBridgeSettingsFromStatus() {
        guard canOpenBridgeSettings else { return }
        if onOpenBridgeSettings?() != true {
            showStatus("未找到扩展设置，请在扩展中开启「启用全局输入桥接」", color: .systemOrange)
        }
    }

    private func applyPromptMode(_ choice: PromptModeChoice) {
        selectedPromptMode = choice
        choice.save()
        modePicker.select(choice)
        refreshPromptPreview()
        refreshCompletionOverlay()
    }

    private func cyclePromptMode(forward: Bool) {
        guard !isSending else { return }
        applyPromptMode(selectedPromptMode.cycled(forward: forward))
    }

    private func refreshPromptPreview() {
        let preview = PromptModePreview.text(for: selectedPromptMode, input: textView.string)
        let text = preview ?? ""
        if previewLabel.stringValue != text {
            crossfade(previewLabel)
        }
        previewLabel.stringValue = text
        previewLabel.isHidden = preview == nil
    }

    private func crossfade(_ label: NSTextField) {
        guard !ComposerAccessibilityOptions.current.reduceMotion else { return }
        label.wantsLayer = true
        let transition = CATransition()
        transition.type = .fade
        transition.duration = 0.12
        transition.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        label.layer?.add(transition, forKey: "textFade")
    }

    private func desiredInputHeight() -> CGFloat {
        guard let layoutManager = textView.layoutManager,
              let container = textView.textContainer else {
            return ComposerMetrics.baseInputHeight
        }
        layoutManager.ensureLayout(for: container)
        let textHeight = layoutManager.usedRect(for: container).height
            + textView.textContainerInset.height * 2
        return composerInputHeight(forTextHeight: textHeight)
    }

    private func updateInputHeight(animated: Bool) {
        guard let panel = window else { return }
        let desired = desiredInputHeight()
        let desiredSuggestion = historyView.contentHeight
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
                self?.textView.scrollRangeToVisible(
                    self?.textView.selectedRange() ?? NSRange(location: 0, length: 0)
                )
            }
        } else {
            apply()
            panel.setFrame(frame, display: true)
            panel.contentView?.layoutSubtreeIfNeeded()
            textView.scrollRangeToVisible(textView.selectedRange())
        }
    }

    /// The history panel and its shadow show only while rows are available.
    /// With reduced transparency the material backdrop is hidden, like the card.
    private func updateHistoryPanelVisibility() {
        let visible = historyPanelHeight > 0
        historyPanelShadow.isHidden = !visible
        historyPanelBackdrop.isHidden = !visible
            || ComposerAccessibilityOptions.current.reduceTransparency
        historyPanelSurface.isHidden = !visible
    }

    // ===== Recent question suggestions =====

    /// Refreshes the rows above the input. The inline trigger completion takes
    /// precedence while it shows, so the two never compete for attention.
    private func refreshHistorySuggestions() {
        guard !isSending,
              !suppressHistory,
              !textView.hasMarkedText(),
              textView.selectedRange().length == 0,
              currentCompletion == nil else {
            clearHistorySuggestions()
            return
        }

        let matches = PromptHistoryStore.matches(historyStore.load(), prefix: textView.string)
        if matches != historyMatches {
            historyMatches = matches
            historySelection = nil
        }
        historyView.present(matches, selectedIndex: historySelection)
    }

    private func clearHistorySuggestions() {
        historyMatches = []
        historySelection = nil
        historyView.dismiss()
    }

    @discardableResult
    private func moveHistorySelection(_ delta: Int) -> Bool {
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
        historyView.present(historyMatches, selectedIndex: historySelection)
        return true
    }

    private func acceptSelectedHistory() -> Bool {
        guard let selection = historySelection, selection < historyMatches.count else { return false }
        applyHistoryQuestion(historyMatches[selection])
        return true
    }

    private func pickHistorySuggestion(at index: Int) {
        guard index >= 0, index < historyMatches.count else { return }
        applyHistoryQuestion(historyMatches[index])
    }

    /// Fills the composer with a past question without sending it.
    private func applyHistoryQuestion(_ question: String) {
        suppressHistory = true
        clearHistorySuggestions()
        textView.string = question
        textView.setSelectedRange(NSRange(location: (question as NSString).length, length: 0))
        placeholder.isHidden = !question.isEmpty
        refreshPromptPreview()
        refreshCompletionOverlay()
        updateInputHeight(animated: true)
        window?.makeFirstResponder(textView)
    }

    /// Esc closes an open history list first; otherwise it hides the panel.
    private func handleEscape() {
        guard historyMatches.isEmpty else {
            suppressHistory = true
            clearHistorySuggestions()
            updateInputHeight(animated: false)
            return
        }
        hide()
    }

    private func applyAccessibilityOptions() {
        let options = ComposerAccessibilityOptions.current
        backdrop.isHidden = options.reduceTransparency
        backdrop.refreshAppearance()
        surfaceView.refreshAppearance()
        shadowView.refreshAppearance()
        historyPanelBackdrop.refreshAppearance()
        historyPanelSurface.refreshAppearance()
        historyPanelShadow.refreshAppearance()
        updateHistoryPanelVisibility()
        previewLabel.textColor = ComposerTheme.previewColor(
            increaseContrast: options.increaseContrast
        )
        shortcutHintView.refreshAppearance()
        modePicker.refreshAppearance()
        sendButton.refreshAppearance()
        completionOverlay.needsDisplay = true
    }

    private func refreshCompletionOverlay() {
        guard let panel = window,
              panel.isVisible,
              !isSending,
              selectedPromptMode == .auto,
              textView.window?.firstResponder === textView,
              !textView.hasMarkedText(),
              textView.selectedRange().length == 0 else {
            currentCompletion = nil
            completionOverlay.dismiss()
            return
        }

        let caret = textView.selectedRange().location
        guard let completion = PromptModePreview.completion(in: textView.string, caret: caret),
              let caretRect = textView.caretRect(forCharacterIndex: caret) else {
            currentCompletion = nil
            completionOverlay.dismiss()
            return
        }

        currentCompletion = completion
        completionOverlay.present(
            completion,
            at: caretRect,
            boundsWidth: textView.bounds.width,
            font: textView.font ?? .systemFont(ofSize: 20, weight: .regular)
        )
    }

    @discardableResult
    private func acceptTriggerCompletion() -> Bool {
        guard !isSending,
              selectedPromptMode == .auto,
              !textView.hasMarkedText(),
              textView.selectedRange().length == 0 else {
            return false
        }

        let caret = textView.selectedRange().location
        guard let completion = PromptModePreview.completion(in: textView.string, caret: caret) else {
            return false
        }

        let text = textView.string as NSString
        let nextIndex = NSMaxRange(completion.range)
        let nextCharacter = nextIndex < text.length
            ? text.substring(with: NSRange(location: nextIndex, length: 1))
            : ""
        let needsSpace = nextCharacter.rangeOfCharacter(from: .whitespacesAndNewlines) == nil
        let insertion = completion.trigger + (needsSpace ? " " : "")
        let replacement = NSAttributedString(
            string: insertion,
            attributes: textView.typingAttributes
        )

        guard textView.performValidatedReplacement(in: completion.range, with: replacement) else {
            return false
        }

        textView.setSelectedRange(NSRange(
            location: completion.range.location + (insertion as NSString).length,
            length: 0
        ))
        refreshPromptPreview()
        refreshCompletionOverlay()
        return true
    }

    private func setupContent() {
        guard let panel = window else { return }
        let inset = ComposerMetrics.shadowInset

        rootView.onOutsideClick = { [weak self] in self?.hide() }
        panel.contentView = rootView

        // The history panel sits above the card but behind it in the stack, so
        // the card's top edge covers the panel's bottom padding.
        rootView.addSubview(historyPanelShadow)
        rootView.addSubview(historyPanelBackdrop)
        rootView.addSubview(historyPanelSurface)
        rootView.addSubview(historyView)

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
        textView.delegate = self
        textView.onEnter = { [weak self] in self?.submit() }
        textView.onEscape = { [weak self] in self?.handleEscape() }
        textView.onTabCompletion = { [weak self] in self?.acceptTriggerCompletion() ?? false }
        textView.onCyclePromptMode = { [weak self] forward in
            self?.cyclePromptMode(forward: forward)
        }
        textView.onArrowUp = { [weak self] in self?.moveHistorySelection(-1) ?? false }
        textView.onArrowDown = { [weak self] in self?.moveHistorySelection(1) ?? false }
        textView.addSubview(completionOverlay)

        historyView.isHidden = true
        historyView.translatesAutoresizingMaskIntoConstraints = false
        historyView.onSelect = { [weak self] index in
            self?.pickHistorySuggestion(at: index)
        }

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

        modePicker.onSelect = { [weak self] choice in
            self?.applyPromptMode(choice)
        }
        modePicker.select(selectedPromptMode)
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

        let footerLeft = NSStackView(views: [statusStack, modePicker])
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

        content.addSubview(scrollView)
        content.addSubview(placeholder)
        content.addSubview(previewLabel)
        content.addSubview(footer)

        let scrollHeight = scrollView.heightAnchor.constraint(
            equalToConstant: ComposerMetrics.baseInputHeight
        )
        scrollHeightConstraint = scrollHeight
        let cardHeight = backdrop.heightAnchor.constraint(
            equalToConstant: composerCardHeight(inputHeight: currentInputHeight)
        )
        cardHeightConstraint = cardHeight
        let historyHeight = historyPanelBackdrop.heightAnchor.constraint(equalToConstant: 0)
        historyHeightConstraint = historyHeight

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
            footerLeft.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
            footerLeft.trailingAnchor.constraint(
                lessThanOrEqualTo: footerRight.leadingAnchor,
                constant: -10
            ),

            footerRight.trailingAnchor.constraint(equalTo: footer.trailingAnchor),
            footerRight.centerYAnchor.constraint(equalTo: footer.centerYAnchor),

            modePicker.heightAnchor.constraint(equalToConstant: ComposerMetrics.modePickerHeight),

            sendButton.widthAnchor.constraint(equalToConstant: ComposerMetrics.sendButtonSize),
            sendButton.heightAnchor.constraint(equalToConstant: ComposerMetrics.sendButtonSize)
        ])

        sendButton.refreshAppearance()
        modePicker.refreshAppearance()
        shortcutHintView.refreshAppearance()
        textView.frame = scrollView.contentView.bounds
    }
}