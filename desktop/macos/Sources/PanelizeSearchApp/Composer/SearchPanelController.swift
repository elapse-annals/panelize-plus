import AppKit
import PanelizeSearchCore

/// The send path the composer drives. `BridgeServer` is the production
/// implementation; tests substitute a bridge that reports progress on demand.
protocol GlobalSendBridge: AnyObject {
    var connectedBrowserBundleIdentifier: String? { get }
    var isExtensionConnected: Bool { get }
    var supportsNewChat: Bool { get }
    func sendPrompt(
        _ text: String,
        promptMode: PromptModeChoice,
        update: @escaping (BridgeSendUpdate) -> Void
    ) -> Bool
    func sendPrompt(
        _ text: String,
        promptMode: PromptModeChoice,
        newChat: Bool,
        update: @escaping (BridgeSendUpdate) -> Void
    ) -> Bool
    @discardableResult
    func requestNewChat(requestId: String, update: @escaping (NewChatUpdate) -> Void) -> Bool
    func requestHistorySync(force: Bool)
}

extension GlobalSendBridge {
    var isExtensionConnected: Bool { true }
    var supportsNewChat: Bool { false }

    func sendPrompt(
        _ text: String,
        promptMode: PromptModeChoice,
        newChat: Bool,
        update: @escaping (BridgeSendUpdate) -> Void
    ) -> Bool {
        sendPrompt(text, promptMode: promptMode, update: update)
    }

    @discardableResult
    func requestNewChat(requestId: String, update: @escaping (NewChatUpdate) -> Void) -> Bool {
        update(.failed("not-connected"))
        return false
    }

    func requestHistorySync(force: Bool) {}
}

extension BridgeServer: GlobalSendBridge {}

final class SearchPanelController: NSWindowController, NSTextViewDelegate, NSWindowDelegate {
    let content = ComposerContent()
    private lazy var suggestions = ComposerSuggestions(
        content: content,
        isSending: { [weak self] in self?.isSending ?? false },
        promptMode: { [weak self] in self?.selectedPromptMode ?? .auto },
        refreshPreview: { [weak self] in self?.refreshPromptPreview() },
        hidePanel: { [weak self] in self?.hide() },
        historyStore: historyStore
    )
    private let bridge: GlobalSendBridge
    private let historyStore: PromptHistoryStore
    private let newChatPreference: NewChatPreference
    private var newChatState: NewChatState
    private lazy var historyBrowser = ComposerHistoryBrowser(
        content: content,
        store: historyStore,
        showStatus: { [weak self] text in
            self?.showTransientStatus(text, color: .systemGreen)
        }
    )
    private let activateBrowserOverride: ((String) -> Bool)?
    private var lastSubmittedText: String?
    private var selectedPromptMode = PromptModeChoice.load()
    private(set) var isSending = false
    private var connectionReady = false
    private var autoHideWorkItem: DispatchWorkItem?
    private var transientStatusWorkItem: DispatchWorkItem?
    private var didForceRegular = false
    private var currentConnectionText = "浏览器未连接"
    private(set) var latestProgress: SendProgress?
    private var didActivateBrowserForRequest = false
    private(set) var isShowingSendResult = false

    private var hideGeneration = 0
    private var isHiding = false
    private var accessibilityObserver: NSObjectProtocol?

    /// Opens the extension settings at the global-input bridge switch. Returns
    /// false when the native host manifest is missing.
    var onOpenBridgeSettings: (() -> Bool)?
    private var globalClickMonitor: Any?
    private var appResignObserver: NSObjectProtocol?
    private var shownAt = Date.distantPast

    init(
        bridge: GlobalSendBridge,
        activateBrowser: ((String) -> Bool)? = nil,
        historyStore: PromptHistoryStore = PromptHistoryStore(),
        newChatPreference: NewChatPreference = NewChatPreference()
    ) {
        self.bridge = bridge
        self.activateBrowserOverride = activateBrowser
        self.historyStore = historyStore
        self.newChatPreference = newChatPreference
        self.newChatState = NewChatState(enabled: newChatPreference.load())
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
        content.build(in: panel, mode: selectedPromptMode, delegate: self, actions: ComposerActions(
            hide: { [weak self] in self?.hide() },
            submit: { [weak self] in self?.submit() },
            handleEscape: { [weak self] in
                guard let self else { return }
                if self.historyBrowser.isVisible {
                    self.historyBrowser.close(restoreFocus: true)
                    return
                }
                self.suggestions.handleEscape()
            },
            acceptTriggerCompletion: { [weak self] in self?.suggestions.acceptTriggerCompletion() ?? false },
            cyclePromptMode: { [weak self] in self?.cyclePromptMode(forward: $0) },
            moveHistorySelection: { [weak self] delta in
                guard let self else { return false }
                if self.historyBrowser.isVisible {
                    self.historyBrowser.moveSelection(delta)
                    return true
                }
                if delta < 0,
                   !self.isSending,
                   self.content.textView.string.isEmpty,
                   !self.content.textView.hasMarkedText() {
                    self.suggestions.clearHistorySuggestions()
                    self.suggestions.suppressHistory = true
                    if self.historyBrowser.openIfPossible() {
                        return true
                    }
                }
                return self.suggestions.moveHistorySelection(delta)
            },
            pickHistorySuggestion: { [weak self] in self?.suggestions.pickHistorySuggestion(at: $0) },
            applyPromptMode: { [weak self] in self?.applyPromptMode($0) },
            toggleNewChat: { [weak self] in self?.setNewChatEnabled($0) },
            openBridgeSettings: { [weak self] in self?.openBridgeSettingsFromStatus() }
        ))
        content.newChatCheckbox.state = newChatState.enabled ? .on : .off
        historyBrowser.onFillRequested = { [weak self] in self?.fillHistorySelection() }
        updateConnection(label: currentConnectionText, ready: false)
        accessibilityObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.content.applyAccessibilityOptions()
        }
        content.applyAccessibilityOptions()
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
        if !ready {
            newChatState.connectionLost()
        }
        updateConnection(label: text, ready: ready)
    }

    /// Called when the extension handshake completes; a checked box can now
    /// prepare the next round.
    func handleExtensionConnected() {
        bridge.requestHistorySync(force: false)
        if newChatState.enabled {
            prepareNewChatIfNeeded()
        }
    }

    /// The bridge merged new history; refresh a visible browser and the
    /// inline prefix suggestions without disturbing the selected row.
    func historyDidChange(_ records: [PromptHistoryRecord]? = nil) {
        let current = records ?? historyStore.loadRecords()
        if historyBrowser.isVisible {
            historyBrowser.update(records: current)
        }
        suggestions.refreshHistorySuggestions()
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
        suggestions.suppressHistory = false
        suggestions.refreshHistorySuggestions()
        content.layout.updateInputHeight(animated: false)

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
            contentSize: content.layout.composerContentSize,
            shadowInset: ComposerMetrics.shadowInset
        )
        let targetFrame = CGRect(origin: targetOrigin, size: content.layout.composerWindowSize)

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

        if isSending {
            // Restoring the panel while the extension prepares or sends shows
            // the latest progress instead of a stale connection label.
            renderSendProgress()
        } else {
            updateConnection(label: currentConnectionText, ready: connectionReady)
        }
        refreshPromptPreview()
        panel.makeFirstResponder(content.textView)
        suggestions.refreshCompletionOverlay()
        startDismissMonitoring()
        bridge.requestHistorySync(force: false)
        if newChatState.enabled {
            prepareNewChatIfNeeded()
        }
    }

    func repositionForScreenChanges() {
        guard let panel = window,
              panel.isVisible,
              let screen = panel.screen ?? NSScreen.main else { return }
        // Re-clamp the history browser before measuring the window.
        content.layout.updateInputHeight(animated: false)
        let origin = composerWindowOrigin(
            visibleFrame: screen.visibleFrame,
            contentSize: content.layout.composerContentSize,
            shadowInset: ComposerMetrics.shadowInset
        )
        var frame = panel.frame
        frame.origin = origin
        frame.size = content.layout.composerWindowSize
        panel.setFrame(frame, display: true)
    }

    func hide() {
        guard let panel = window else { return }
        autoHideWorkItem?.cancel()
        autoHideWorkItem = nil
        transientStatusWorkItem?.cancel()
        transientStatusWorkItem = nil
        stopDismissMonitoring()
        historyBrowser.close(restoreFocus: false)
        suggestions.dismissCompletion()
        content.completionOverlay.dismiss()

        hideGeneration += 1
        let generation = hideGeneration
        isHiding = true
        isShowingSendResult = false
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

    func windowDidBecomeKey(_ notification: Notification) {
        // A short focus pulse, matching the extension's composer edge sweep.
        content.pulseCardFocus()
    }

    func windowDidResignKey(_ notification: Notification) {
        // Keep the composer on screen when macOS declines to activate an
        // accessory app from the hotkey. Escape, the shortcut and a successful
        // send all dismiss it; losing key focus alone should not. Hover
        // emphasis tracks the pointer with .activeAlways, so it stays correct
        // while the panel is inactive.
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

        // The send brings the browser forward, and the panel may stay up while
        // progress or the success result is shown. Losing active state is not
        // the user dismissing the composer in those phases; an outside click,
        // Escape or the shortcut still closes it.
        appResignObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didResignActiveNotification,
            object: NSApp,
            queue: .main
        ) { [weak self] _ in
            DispatchQueue.main.async {
                self?.dismissForAppResign()
            }
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

    func dismissForOutsideInteraction() {
        guard let panel = window, panel.isVisible else { return }
        guard Date().timeIntervalSince(shownAt) > 0.15 else { return }
        // Clicking an input-method candidate window is not an outside click.
        guard !content.textView.hasMarkedText() else { return }
        hide()
    }

    func dismissForAppResign() {
        guard !isSending, !isShowingSendResult else { return }
        dismissForOutsideInteraction()
    }

    func textDidChange(_ notification: Notification) {
        if historyBrowser.isVisible {
            historyBrowser.close(restoreFocus: false)
        }
        content.placeholder.isHidden = !content.textView.string.isEmpty
        suggestions.suppressHistory = false
        refreshPromptPreview()
        suggestions.refreshCompletionOverlay()
        suggestions.refreshHistorySuggestions()
        content.layout.updateInputHeight(animated: true)
    }

    func textViewDidChangeSelection(_ notification: Notification) {
        suggestions.refreshCompletionOverlay()
        suggestions.refreshHistorySuggestions()
        content.layout.updateInputHeight(animated: false)
    }

    func textDidBeginEditing(_ notification: Notification) {
        suggestions.refreshCompletionOverlay()
        suggestions.refreshHistorySuggestions()
        content.layout.updateInputHeight(animated: false)
    }

    func textDidEndEditing(_ notification: Notification) {
        suggestions.dismissCompletion()
        content.completionOverlay.dismiss()
        suggestions.clearHistorySuggestions()
        content.layout.updateInputHeight(animated: false)
    }

    func submit() {
        guard !isSending else { return }
        // Enter on the two-column browser fills the question without sending.
        if historyBrowser.isVisible {
            fillHistorySelection()
            return
        }
        // Enter on a highlighted suggestion fills it instead of sending.
        if suggestions.acceptSelectedHistory() { return }
        autoHideWorkItem?.cancel()

        let normalized: String
        switch PromptInput.normalized(content.textView.string) {
        case .failure(.empty):
            showStatus("请输入要发送的内容", color: .systemOrange)
            return
        case .failure(.tooLong):
            showStatus("内容过长（最多 \(BridgeProtocol.maxPromptCharacters) 字符）", color: .systemRed)
            return
        case .success(let value):
            normalized = value
        }

        let text = content.textView.string
        lastSubmittedText = normalized
        latestProgress = nil
        didActivateBrowserForRequest = false
        isShowingSendResult = false
        isSending = true
        setBusy(true)
        showStatus("正在发送…", color: .systemBlue)

        let started = bridge.sendPrompt(
            text,
            promptMode: selectedPromptMode,
            newChat: newChatState.enabled && bridge.supportsNewChat
        ) { [weak self] update in
            guard let self else { return }
            switch update {
            case .accepted:
                // An extension without progress reporting keeps the generic
                // waiting state and brings the browser forward on success.
                if self.latestProgress == nil {
                    self.showStatus("等待 AI 接收…", color: .systemBlue)
                }
            case .progress(let progress):
                self.handleSendProgress(progress)
            case .failed(let message):
                self.isSending = false
                self.setBusy(false)
                self.endSendProgress()
                self.showStatus(message, color: .systemRed)
            case .succeeded(let outcome):
                self.isSending = false
                self.setBusy(false)
                self.endSendProgress()
                self.handleSuccess(outcome)
            }
        }

        if !started {
            isSending = false
            setBusy(false)
            endSendProgress()
        }
    }

    private func fillHistorySelection() {
        guard let question = historyBrowser.takeSelectedQuestion() else { return }
        suggestions.applyHistoryQuestion(question)
    }

    private func setNewChatEnabled(_ enabled: Bool) {
        guard !isSending else {
            content.newChatCheckbox.state = newChatState.enabled ? .on : .off
            return
        }
        newChatPreference.save(enabled)
        newChatState.setEnabled(enabled)
        content.newChatCheckbox.state = enabled ? .on : .off
        if enabled {
            if !bridge.isExtensionConnected {
                showTransientStatus("浏览器未连接，下次发送时会新建会话", color: .systemOrange)
                return
            }
            prepareNewChatIfNeeded()
        } else {
            transientStatusWorkItem?.cancel()
            updateConnection(label: currentConnectionText, ready: connectionReady)
        }
    }

    /// Starts a silent reset in the extension. The result only drives the hint
    /// and the checkbox state; a send still carries its own new-chat flag.
    private func prepareNewChatIfNeeded() {
        guard newChatState.enabled, !isSending, bridge.isExtensionConnected else { return }
        let requestId = UUID().uuidString
        guard newChatState.prepareIfNeeded(requestId: requestId) else { return }

        let started = bridge.requestNewChat(requestId: requestId) { [weak self] update in
            guard let self else { return }
            switch update {
            case .succeeded(let outcome):
                guard self.newChatState.completeRequest(
                    outcome.requestId,
                    ok: outcome.ok,
                    ready: outcome.ready,
                    total: outcome.total
                ) else { return }
                if outcome.ok {
                    self.showTransientStatus("已为所有 AI 新建会话", color: .systemGreen)
                } else {
                    let reason = outcome.reason.isEmpty ? "partial" : outcome.reason
                    self.showTransientStatus(
                        BridgeMessages.errorReason(reason),
                        color: .systemOrange
                    )
                }
            case .failed(let message):
                if self.newChatState.failRequest(requestId) {
                    self.showTransientStatus(message, color: .systemOrange)
                }
            }
        }
        if !started {
            newChatState.failRequest(requestId)
        }
    }

    /// A short, non-blocking status line that returns to the connection label.
    private func showTransientStatus(_ text: String, color: NSColor) {
        guard !isSending else { return }
        transientStatusWorkItem?.cancel()
        showStatus(text, color: color)
        let item = DispatchWorkItem { [weak self] in
            guard let self, !self.isSending else { return }
            self.updateConnection(label: self.currentConnectionText, ready: self.connectionReady)
        }
        transientStatusWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.6, execute: item)
    }

    /// Shows readiness and waiting names, and brings the browser forward once
    /// the extension confirms the Multi-Panel page is open. Repeats are ignored.
    private func handleSendProgress(_ progress: SendProgress) {
        guard isSending else { return }
        if let current = latestProgress {
            // The extension already filters repeats; keep the client's line
            // from moving backwards if an older peer sends out of order.
            if progressRank(progress.stage) < progressRank(current.stage) {
                return
            }
            if current.stage == progress.stage,
               current.signature == progress.signature {
                return
            }
        }
        latestProgress = progress
        activateBrowserIfNeeded()
        renderSendProgress()
    }

    private func progressRank(_ stage: SendProgressStage) -> Int {
        switch stage {
        case .opening: return 0
        case .preparing: return 1
        case .sending: return 2
        }
    }

    private func renderSendProgress() {
        guard isSending, let progress = latestProgress else { return }
        showStatus(SendProgressText.status(for: progress), color: .systemBlue)
        refreshPromptPreview()
    }

    /// The send is over: drop the progress line and restore the prompt-mode
    /// preview, whether the round succeeded or failed.
    private func endSendProgress() {
        latestProgress = nil
        refreshPromptPreview()
    }

    private func handleSuccess(_ outcome: SendOutcome) {
        guard outcome.ok, outcome.sent > 0 else {
            showStatus(BridgeMessages.errorReason(outcome.reason), color: .systemRed)
            return
        }

        isShowingSendResult = true
        let status = outcome.sent < outcome.total
            ? "已发送至 \(outcome.sent)/\(outcome.total) 个 AI（其余未就绪）"
            : "已发送至 \(outcome.sent) 个 AI"
        showStatus(status, color: .systemGreen)
        if let prompt = lastSubmittedText {
            suggestions.recordQuestion(prompt)
        }
        // The prepared fresh session has now been used; the next round needs
        // another reset (triggered on the next show or send).
        newChatState.sendSucceeded()
        lastSubmittedText = nil
        suggestions.suppressHistory = true
        suggestions.clearHistorySuggestions()
        content.textView.string = ""
        content.placeholder.isHidden = false
        content.layout.updateInputHeight(animated: true)
        refreshPromptPreview()
        suggestions.refreshCompletionOverlay()

        // An older extension sends no progress, so the result is the first
        // confirmation that the panels are open and have the prompt.
        activateBrowserIfNeeded()

        let workItem = DispatchWorkItem { [weak self] in
            self?.hide()
        }
        autoHideWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.15, execute: workItem)
    }

    /// Activates the browser app that hosts the native bridge once per request.
    /// Activating the app also raises the Multi-Panel window.
    private func activateBrowserIfNeeded() {
        guard !didActivateBrowserForRequest else { return }
        guard activateConnectedBrowser() else { return }
        didActivateBrowserForRequest = true
    }

    @discardableResult
    private func activateConnectedBrowser() -> Bool {
        guard let bundleIdentifier = bridge.connectedBrowserBundleIdentifier else {
            return false
        }
        if let activateBrowserOverride {
            return activateBrowserOverride(bundleIdentifier)
        }
        guard let application = NSRunningApplication.runningApplications(
            withBundleIdentifier: bundleIdentifier
        ).first else {
            return false
        }
        _ = application.unhide()
        return application.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
    }

    private func setBusy(_ busy: Bool) {
        content.textView.isEditable = !busy
        content.sendButton.setSending(busy, animated: true)
        content.modePicker.isEnabled = !busy
        content.newChatCheckbox.isEnabled = !busy
        if busy {
            historyBrowser.close(restoreFocus: false)
            suggestions.dismissCompletion()
            suggestions.suppressHistory = true
            suggestions.clearHistorySuggestions()
            content.layout.updateInputHeight(animated: false)
        } else {
            suggestions.refreshCompletionOverlay()
            suggestions.refreshHistorySuggestions()
            content.layout.updateInputHeight(animated: false)
        }
    }

    private func updateConnection(label: String, ready: Bool) {
        guard !isSending else { return }
        if ready {
            content.statusIcon.update(
                symbolName: "checkmark.circle.fill",
                color: .systemGreen,
                accessibilityLabel: "Panelize 已连接"
            )
            content.statusLabel.stringValue = ""
            content.statusLabel.isHidden = true
        } else {
            let short = shortConnectionText(label)
            content.statusIcon.update(
                symbolName: "exclamationmark.circle.fill",
                color: .systemOrange,
                accessibilityLabel: nil
            )
            content.statusLabel.isHidden = false
            content.statusLabel.stringValue = short
            content.statusLabel.textColor = .systemOrange
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
        if content.statusLabel.stringValue != text {
            crossfade(content.statusLabel)
        }
        content.statusLabel.isHidden = false
        content.statusLabel.stringValue = text
        content.statusLabel.textColor = color
        content.statusIcon.update(
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
        let text = content.statusLabel.stringValue
        return text.contains("未连接") || text.contains("等待扩展")
    }

    private func refreshStatusInteraction() {
        let actionable = canOpenBridgeSettings
        content.statusStack.isActionable = actionable
        let help = "打开扩展设置，开启「启用全局输入桥接」"
        content.statusLabel.toolTip = actionable ? help : nil
        content.statusLabel.setAccessibilityRole(actionable ? .button : .staticText)
        content.statusLabel.setAccessibilityHelp(actionable ? help : nil)
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
        content.modePicker.select(choice)
        content.updateModeHint(for: choice)
        refreshPromptPreview()
        suggestions.refreshCompletionOverlay()
    }

    private func cyclePromptMode(forward: Bool) {
        guard !isSending else { return }
        applyPromptMode(selectedPromptMode.cycled(forward: forward))
    }

    private func refreshPromptPreview() {
        if isSending,
           let progress = latestProgress,
           let text = SendProgressText.preview(for: progress) {
            setPreviewText(text, full: SendProgressText.fullPreview(for: progress) ?? text)
            return
        }
        let preview = PromptModePreview.text(for: selectedPromptMode, input: content.textView.string)
        setPreviewText(preview, full: nil)
    }

    /// The full text stays available on hover and to assistive technologies
    /// when the one-line preview truncates a long list of AI names.
    private func setPreviewText(_ text: String?, full: String?) {
        let value = text ?? ""
        if content.previewLabel.stringValue != value {
            crossfade(content.previewLabel)
        }
        content.previewLabel.stringValue = value
        content.previewLabel.isHidden = text == nil
        content.previewLabel.toolTip = full
        content.previewLabel.setAccessibilityElement(full != nil)
        if let full {
            content.previewLabel.setAccessibilityLabel("发送进度")
            content.previewLabel.setAccessibilityValue(full)
        }
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

}
