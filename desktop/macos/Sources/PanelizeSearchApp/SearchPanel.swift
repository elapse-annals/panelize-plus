import AppKit
import PanelizeSearchCore

final class SearchPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class PromptTextView: NSTextView {
    var onEnter: (() -> Void)?
    var onEscape: (() -> Void)?

    override func keyDown(with event: NSEvent) {
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
}

private final class StatusDot: NSView {
    var color: NSColor = .systemGray {
        didSet { needsDisplay = true }
    }

    override func draw(_ dirtyRect: NSRect) {
        color.setFill()
        NSBezierPath(ovalIn: bounds.insetBy(dx: 1, dy: 1)).fill()
    }
}

private final class SendButton: NSButton {
    override func updateLayer() {
        super.updateLayer()
        wantsLayer = true
        layer?.backgroundColor = NSColor.labelColor.cgColor
        layer?.cornerRadius = bounds.height / 2
        contentTintColor = NSColor.textBackgroundColor
    }
}

final class SearchPanelController: NSWindowController, NSTextViewDelegate, NSWindowDelegate {
    private let bridge: BridgeServer
    private let textView = PromptTextView()
    private let scrollView = NSScrollView()
    private let placeholder = NSTextField(labelWithString: "输入问题，发送给所有 AI…")
    private let statusLabel = NSTextField(labelWithString: "")
    private let statusDot = StatusDot()
    private let sendButton = SendButton()
    private let hintLabel = NSTextField(labelWithString: "Enter 发送 · ⇧Enter 换行 · Esc 关闭")
    private let modePopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private var selectedPromptMode = PromptModeChoice.load()
    private var isSending = false
    private var connectionReady = false
    private var autoHideWorkItem: DispatchWorkItem?
    private var didForceRegular = false
    private var currentConnectionText = "浏览器未连接"

    init(bridge: BridgeServer) {
        self.bridge = bridge
        let panel = SearchPanel(
            contentRect: NSRect(x: 0, y: 0, width: 680, height: 164),
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
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setConnectionStatus(_ text: String, ready: Bool) {
        currentConnectionText = text
        connectionReady = ready
        updateConnection(label: text, ready: ready)
    }

    func toggle() {
        guard let panel = window else { return }
        if panel.isVisible {
            hide()
        } else {
            show()
        }
    }

    func show() {
        guard let panel = window else {
            return
        }
        // NSScreen.main follows the key window, which can be on another
        // display when the shortcut fires. Show on the display with the mouse.
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first {
            NSMouseInRect(mouse, $0.frame, false)
        } ?? NSScreen.main ?? NSScreen.screens.first
        guard let screen else { return }
        autoHideWorkItem?.cancel()
        let visible = screen.visibleFrame
        let size = panel.frame.size
        panel.setFrameOrigin(composerOrigin(visibleFrame: visible, panelSize: size))

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
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
        if !isSending {
            updateConnection(label: currentConnectionText, ready: connectionReady)
        }
        panel.makeFirstResponder(textView)
    }

    func repositionForScreenChanges() {
        guard let panel = window,
              panel.isVisible,
              let screen = panel.screen ?? NSScreen.main else { return }
        panel.setFrameOrigin(composerOrigin(
            visibleFrame: screen.visibleFrame,
            panelSize: panel.frame.size
        ))
    }

    func hide() {
        autoHideWorkItem?.cancel()
        autoHideWorkItem = nil
        window?.orderOut(nil)
        if didForceRegular {
            didForceRegular = false
            NSApp.setActivationPolicy(.accessory)
        }
    }

    func windowDidResignKey(_ notification: Notification) {
        // Keep the composer on screen when macOS declines to activate an
        // accessory app from the hotkey. Escape, the shortcut and a successful
        // send all dismiss it; losing key focus alone should not.
    }

    func textDidChange(_ notification: Notification) {
        placeholder.isHidden = !textView.string.isEmpty
    }

    @objc private func sendTapped() {
        submit()
    }

    private func submit() {
        guard !isSending else { return }
        autoHideWorkItem?.cancel()

        switch PromptInput.normalized(textView.string) {
        case .failure(.empty):
            showStatus("请输入要发送的内容", color: .systemOrange)
            return
        case .failure(.tooLong):
            showStatus("内容过长（最多 \(BridgeProtocol.maxPromptCharacters) 字符）", color: .systemRed)
            return
        case .success:
            break
        }

        let text = textView.string
        isSending = true
        setBusy(true)
        showStatus("正在交给 Panelize…", color: .systemBlue)

        let started = bridge.sendPrompt(text, promptMode: selectedPromptMode) { [weak self] update in
            guard let self else { return }
            switch update {
            case .accepted:
                self.showStatus("已交给 Panelize，等待 AI 接收…", color: .systemBlue)
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
        textView.string = ""
        placeholder.isHidden = false

        let workItem = DispatchWorkItem { [weak self] in
            self?.hide()
        }
        autoHideWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.15, execute: workItem)
    }

    private func setBusy(_ busy: Bool) {
        textView.isEditable = !busy
        sendButton.isEnabled = !busy
        sendButton.alphaValue = busy ? 0.45 : 1
        modePopup.isEnabled = !busy
    }

    private func updateConnection(label: String, ready: Bool) {
        guard !isSending else { return }
        statusDot.color = ready ? .systemGreen : .systemOrange
        statusLabel.stringValue = ready ? "Panelize 已连接 · 输入后按 Enter 发送" : label
        statusLabel.textColor = ready ? .secondaryLabelColor : .systemOrange
    }

    private func showStatus(_ text: String, color: NSColor) {
        statusLabel.stringValue = text
        statusLabel.textColor = color
        statusDot.color = color
    }

    @objc private func promptModeChanged() {
        guard let raw = modePopup.selectedItem?.representedObject as? String,
              let choice = PromptModeChoice(rawValue: raw) else {
            return
        }
        selectedPromptMode = choice
        choice.save()
        updatePromptModeTooltip()
    }

    private func selectPromptMode(_ choice: PromptModeChoice) {
        let item = modePopup.itemArray.first {
            $0.representedObject as? String == choice.rawValue
        }
        if let item {
            modePopup.select(item)
        }
    }

    private func updatePromptModeTooltip() {
        modePopup.toolTip = "提示词模式：\(selectedPromptMode.title)（\(selectedPromptMode.detail)）"
        modePopup.setAccessibilityLabel("提示词模式")
        modePopup.setAccessibilityHelp(selectedPromptMode.detail)
    }

    private func setupContent() {
        guard let panel = window else { return }
        let backdrop = NSVisualEffectView()
        backdrop.material = .popover
        backdrop.blendingMode = .behindWindow
        backdrop.state = .active
        backdrop.wantsLayer = true
        backdrop.layer?.cornerRadius = 22
        backdrop.layer?.masksToBounds = true
        backdrop.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView()
        content.translatesAutoresizingMaskIntoConstraints = false
        backdrop.addSubview(content)

        textView.isRichText = false
        textView.drawsBackground = false
        textView.focusRingType = .none
        textView.font = .systemFont(ofSize: 20, weight: .regular)
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
        textView.onEscape = { [weak self] in self?.hide() }

        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.focusRingType = .none
        scrollView.hasVerticalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.documentView = textView
        scrollView.translatesAutoresizingMaskIntoConstraints = false

        placeholder.font = .systemFont(ofSize: 20, weight: .regular)
        placeholder.textColor = .placeholderTextColor
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        placeholder.isEditable = false
        placeholder.isSelectable = false
        placeholder.isBordered = false
        placeholder.drawsBackground = false

        statusDot.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = .systemFont(ofSize: 12, weight: .regular)
        statusLabel.lineBreakMode = .byTruncatingTail
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.textColor = .secondaryLabelColor

        hintLabel.font = .systemFont(ofSize: 11, weight: .regular)
        hintLabel.textColor = .tertiaryLabelColor
        hintLabel.translatesAutoresizingMaskIntoConstraints = false

        let modeLabel = NSTextField(labelWithString: "模式")
        modeLabel.font = .systemFont(ofSize: 11, weight: .regular)
        modeLabel.textColor = .tertiaryLabelColor
        modeLabel.translatesAutoresizingMaskIntoConstraints = false

        modePopup.controlSize = .small
        modePopup.font = .systemFont(ofSize: 11, weight: .regular)
        modePopup.bezelStyle = .inline
        modePopup.contentTintColor = .secondaryLabelColor
        modePopup.target = self
        modePopup.action = #selector(promptModeChanged)
        modePopup.translatesAutoresizingMaskIntoConstraints = false
        for choice in PromptModeChoice.allCases {
            modePopup.addItem(withTitle: choice.title)
            let item = modePopup.item(at: modePopup.numberOfItems - 1)
            item?.representedObject = choice.rawValue
            item?.toolTip = choice.detail
            if choice == .auto {
                modePopup.menu?.insertItem(.separator(), at: modePopup.numberOfItems)
            }
        }
        selectPromptMode(selectedPromptMode)
        updatePromptModeTooltip()

        sendButton.image = NSImage(
            systemSymbolName: "arrow.up",
            accessibilityDescription: "发送给所有 AI"
        )
        sendButton.imagePosition = .imageOnly
        sendButton.isBordered = false
        sendButton.wantsLayer = true
        sendButton.target = self
        sendButton.action = #selector(sendTapped)
        sendButton.translatesAutoresizingMaskIntoConstraints = false
        sendButton.toolTip = "发送给所有 AI（Enter）"

        let statusStack = NSStackView(views: [statusDot, statusLabel])
        statusStack.orientation = .horizontal
        statusStack.spacing = 6
        statusStack.alignment = .centerY
        statusStack.translatesAutoresizingMaskIntoConstraints = false

        let footerRight = NSStackView(views: [modeLabel, modePopup, hintLabel, sendButton])
        footerRight.orientation = .horizontal
        footerRight.spacing = 10
        footerRight.alignment = .centerY
        footerRight.translatesAutoresizingMaskIntoConstraints = false
        modePopup.setContentCompressionResistancePriority(.required, for: .horizontal)
        hintLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        statusLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let footer = NSView()
        footer.translatesAutoresizingMaskIntoConstraints = false
        footer.addSubview(statusStack)
        footer.addSubview(footerRight)

        content.addSubview(scrollView)
        content.addSubview(placeholder)
        content.addSubview(footer)
        panel.contentView = backdrop

        NSLayoutConstraint.activate([
            backdrop.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor),
            backdrop.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor),
            backdrop.topAnchor.constraint(equalTo: panel.contentView!.topAnchor),
            backdrop.bottomAnchor.constraint(equalTo: panel.contentView!.bottomAnchor),

            content.leadingAnchor.constraint(equalTo: backdrop.leadingAnchor, constant: 20),
            content.trailingAnchor.constraint(equalTo: backdrop.trailingAnchor, constant: -20),
            content.topAnchor.constraint(equalTo: backdrop.topAnchor, constant: 17),
            content.bottomAnchor.constraint(equalTo: backdrop.bottomAnchor, constant: -13),

            scrollView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: content.topAnchor),
            scrollView.heightAnchor.constraint(equalToConstant: 74),

            placeholder.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 2),
            placeholder.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 6),

            footer.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            footer.heightAnchor.constraint(equalToConstant: 34),

            statusDot.widthAnchor.constraint(equalToConstant: 8),
            statusDot.heightAnchor.constraint(equalToConstant: 8),
            statusStack.leadingAnchor.constraint(equalTo: footer.leadingAnchor),
            statusStack.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
            statusStack.trailingAnchor.constraint(lessThanOrEqualTo: footerRight.leadingAnchor, constant: -10),

            footerRight.trailingAnchor.constraint(equalTo: footer.trailingAnchor),
            footerRight.centerYAnchor.constraint(equalTo: footer.centerYAnchor),

            sendButton.widthAnchor.constraint(equalToConstant: 34),
            sendButton.heightAnchor.constraint(equalToConstant: 34)
        ])

        textView.frame = scrollView.contentView.bounds
        panel.invalidateShadow()
    }
}