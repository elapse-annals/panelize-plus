import AppKit
import PanelizeSearchCore

/// The left column's scrollable question list. It is drawn rather than built
/// from controls so it never takes keyboard focus from the composer input.
final class HistoryListContentView: NSView {
    var onSelect: ((Int) -> Void)?
    var onActivate: ((Int) -> Void)?

    private(set) var records: [PromptHistoryRecord] = []
    private(set) var selectedIndex = 0
    private var nowMillis: Double = PromptHistoryStore.currentMillis()
    private var hoveredIndex: Int?
    private var trackingArea: NSTrackingArea?

    let rowHeight: CGFloat = 54

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { false }
    override var mouseDownCanMoveWindow: Bool { false }

    var requiredHeight: CGFloat {
        max(rowHeight, CGFloat(records.count) * rowHeight + 8)
    }

    func update(records: [PromptHistoryRecord], selectedIndex: Int, nowMillis: Double) {
        self.records = records
        self.selectedIndex = max(0, min(selectedIndex, max(0, records.count - 1)))
        self.nowMillis = nowMillis
        if records.isEmpty { hoveredIndex = nil }
        needsDisplay = true
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea {
            removeTrackingArea(trackingArea)
        }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingArea = area
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .pointingHand)
    }

    override func mouseMoved(with event: NSEvent) {
        let index = rowIndex(at: convert(event.locationInWindow, from: nil))
        guard index != hoveredIndex else { return }
        hoveredIndex = index
        needsDisplay = true
    }

    override func mouseExited(with event: NSEvent) {
        guard hoveredIndex != nil else { return }
        hoveredIndex = nil
        needsDisplay = true
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard let index = rowIndex(at: point) else { return }
        selectedIndex = index
        needsDisplay = true
        if event.clickCount >= 2 {
            onActivate?(index)
        } else {
            onSelect?(index)
        }
    }

    private func rowIndex(at point: NSPoint) -> Int? {
        guard !records.isEmpty else { return nil }
        let index = Int((point.y - 4) / rowHeight)
        guard index >= 0, index < records.count else { return nil }
        return index
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard !records.isEmpty else { return }
        let options = ComposerAccessibilityOptions.current

        for (index, record) in records.enumerated() {
            let rowRect = NSRect(
                x: 6,
                y: 4 + CGFloat(index) * rowHeight,
                width: bounds.width - 12,
                height: rowHeight - 4
            )
            if index == selectedIndex || index == hoveredIndex {
                NSColor.controlAccentColor.withAlphaComponent(0.14).setFill()
                NSBezierPath(roundedRect: rowRect, xRadius: 8, yRadius: 8).fill()
            }

            let selected = index == selectedIndex
            let titleColor = selected
                ? NSColor.labelColor
                : NSColor.labelColor.withAlphaComponent(0.84)
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineBreakMode = .byTruncatingTail
            paragraph.lineSpacing = 1
            let title = NSAttributedString(
                string: record.text.replacingOccurrences(of: "\n", with: " "),
                attributes: [
                    .font: ComposerFonts.historyBrowserRowTitle,
                    .foregroundColor: titleColor,
                    .paragraphStyle: paragraph
                ]
            )
            title.draw(
                with: NSRect(
                    x: rowRect.minX + 8,
                    y: rowRect.minY + 7,
                    width: rowRect.width - 16,
                    height: 31
                ),
                options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine]
            )

            let time = historyTimestampText(millis: record.updatedAtMillis, nowMillis: nowMillis)
            let meta = NSAttributedString(
                string: time,
                attributes: [
                    .font: ComposerFonts.historyBrowserRowMeta,
                    .foregroundColor: NSColor.tertiaryLabelColor
                ]
            )
            meta.draw(at: NSPoint(x: rowRect.minX + 8, y: rowRect.maxY - 19))

            let status = record.hasSummary ? "总结" : "暂无总结"
            let statusColor = record.hasSummary
                ? ComposerTheme.accentPurple
                : NSColor.tertiaryLabelColor
            let statusText = NSAttributedString(
                string: status,
                attributes: [
                    .font: ComposerFonts.historyBrowserRowMeta,
                    .foregroundColor: options.increaseContrast ? .labelColor : statusColor
                ]
            )
            let statusSize = statusText.size()
            statusText.draw(at: NSPoint(
                x: rowRect.maxX - 8 - statusSize.width,
                y: rowRect.maxY - 19
            ))
        }
    }
}

/// The summary body. In the two-column layout a double click expands the
/// reading view; once expanded the same text view keeps AppKit's native
/// double-click word selection, triple-click, drag selection and context menu.
final class SummaryTextView: NSTextView {
    /// Returns whether the double click was consumed.
    var onDoubleClickToZoom: (() -> Bool)?

    override func mouseDown(with event: NSEvent) {
        if event.clickCount >= 2, let onDoubleClickToZoom, onDoubleClickToZoom() {
            return
        }
        super.mouseDown(with: event)
    }
}

/// One-pixel line between the two columns. Drawn so Increase Contrast can
/// strengthen it instead of relying on the system separator color.
final class HistorySeparatorView: NSView {
    override var mouseDownCanMoveWindow: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        let options = ComposerAccessibilityOptions.current
        let color = options.increaseContrast
            ? NSColor.labelColor.withAlphaComponent(0.45)
            : NSColor.separatorColor
        color.setFill()
        bounds.fill()
    }
}

/// The expanded reading view's top card: the original question on one
/// truncated line and its relative time. Clicking anywhere on the card opens a
/// scrollable, selectable overlay with the full question.
final class HistoryQuestionCardView: NSView {
    var onOpen: (() -> Void)?

    private(set) var questionText = ""
    private(set) var timeText = ""

    override var acceptsFirstResponder: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        focusRingType = .default
        toolTip = "点击查看完整提问"
        setAccessibilityRole(.button)
        setAccessibilityLabel("原始提问")
        setAccessibilityHelp("显示完整原始提问")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func update(question: String, time: String) {
        guard question != questionText || time != timeText else { return }
        questionText = question
        timeText = time
        setAccessibilityValue(question)
        needsDisplay = true
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        onOpen?()
    }

    /// VoiceOver treats this view as a button, so pressing it opens the full
    /// question overlay too.
    override func accessibilityPerformPress() -> Bool {
        onOpen?()
        return true
    }

    override func draw(_ dirtyRect: NSRect) {
        let options = ComposerAccessibilityOptions.current
        let path = NSBezierPath(
            roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5),
            xRadius: 8,
            yRadius: 8
        )
        NSColor.labelColor
            .withAlphaComponent(options.increaseContrast ? 0.07 : 0.045)
            .setFill()
        path.fill()
        let borderColor = options.increaseContrast
            ? NSColor.labelColor.withAlphaComponent(0.30)
            : NSColor.separatorColor
        borderColor.setStroke()
        path.lineWidth = options.increaseContrast ? 1 : 0.5
        path.stroke()

        let font = ComposerFonts.historyBrowserRowTitle
        let questionHeight = ceil(font.ascender - font.descender + 2)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        let question = NSAttributedString(
            string: questionText.replacingOccurrences(of: "\n", with: " "),
            attributes: [
                .font: font,
                .foregroundColor: NSColor.labelColor,
                .paragraphStyle: paragraph
            ]
        )
        question.draw(
            with: NSRect(
                x: 10,
                y: bounds.height - 8 - questionHeight,
                width: max(0, bounds.width - 20),
                height: questionHeight
            ),
            options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine]
        )

        let time = NSAttributedString(
            string: timeText,
            attributes: [
                .font: ComposerFonts.historyBrowserRowMeta,
                .foregroundColor: options.increaseContrast
                    ? NSColor.secondaryLabelColor
                    : NSColor.tertiaryLabelColor
            ]
        )
        time.draw(at: NSPoint(x: 10, y: 8))
    }

    override var focusRingMaskBounds: NSRect { bounds }

    override func drawFocusRingMask() {
        NSBezierPath(roundedRect: bounds, xRadius: 8, yRadius: 8).fill()
    }
}

/// The expanded view's full-question overlay. It covers the browser, dims the
/// reading view behind a card and lets the question scroll and be selected.
/// Esc (or a click outside the card) closes it and returns focus to the card.
final class HistoryQuestionOverlayView: NSView {
    let scrollView = NSScrollView()
    let textView = NSTextView()

    var onDismiss: (() -> Void)?

    private let headerLabel = NSTextField(labelWithString: "完整原始提问")
    private var cardRect: NSRect = .zero

    override var acceptsFirstResponder: Bool { false }
    override var mouseDownCanMoveWindow: Bool { false }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func build() {
        textView.font = ComposerFonts.historyBrowserBody
        textView.textColor = .labelColor
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.isRichText = false
        textView.focusRingType = .none
        textView.textContainerInset = NSSize(width: 2, height: 2)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.minSize = .zero
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(
            width: 0,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.textContainer?.lineFragmentPadding = 0
        textView.setAccessibilityLabel("完整原始提问")

        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.focusRingType = .none
        scrollView.documentView = textView
        addSubview(scrollView)

        headerLabel.font = ComposerFonts.historyBrowserHeader
        headerLabel.textColor = .secondaryLabelColor
        addSubview(headerLabel)

        setAccessibilityRole(.group)
        setAccessibilityLabel("完整原始提问")
        isHidden = true
    }

    func present(question: String) {
        textView.string = question
        textView.setSelectedRange(NSRange(location: 0, length: 0))
        isHidden = false
        needsLayout = true
        layoutSubtreeIfNeeded()
        scrollView.contentView.scroll(to: .zero)
        scrollView.reflectScrolledClipView(scrollView.contentView)
    }

    func refreshAppearance() {
        let options = ComposerAccessibilityOptions.current
        headerLabel.textColor = options.increaseContrast
            ? .labelColor
            : .secondaryLabelColor
        needsDisplay = true
    }

    override func layout() {
        super.layout()
        cardRect = bounds.insetBy(dx: 14, dy: 14)
        guard cardRect.width > 0, cardRect.height > 0 else { return }

        headerLabel.sizeToFit()
        let headerHeight = max(14, headerLabel.frame.height)
        headerLabel.frame = NSRect(
            x: cardRect.minX + 12,
            y: cardRect.maxY - 10 - headerHeight,
            width: max(0, cardRect.width - 24),
            height: headerHeight
        )
        let scrollTop = headerLabel.frame.minY - 6
        let scrollBottom = cardRect.minY + 10
        scrollView.frame = NSRect(
            x: cardRect.minX + 12,
            y: scrollBottom,
            width: max(0, cardRect.width - 24),
            height: max(0, scrollTop - scrollBottom)
        )
        layoutDocument()
    }

    private func layoutDocument() {
        let viewport = scrollView.contentSize
        guard viewport.width > 0, viewport.height > 0 else { return }
        textView.minSize = NSSize(width: viewport.width, height: viewport.height)
        textView.maxSize = NSSize(
            width: viewport.width,
            height: CGFloat.greatestFiniteMagnitude
        )
        guard let container = textView.textContainer,
              let layoutManager = textView.layoutManager else { return }
        container.containerSize = NSSize(
            width: viewport.width,
            height: CGFloat.greatestFiniteMagnitude
        )
        container.widthTracksTextView = true
        layoutManager.ensureLayout(for: container)
        let textHeight = layoutManager.usedRect(for: container).height
            + textView.textContainerInset.height * 2
        textView.frame = NSRect(
            x: 0,
            y: 0,
            width: viewport.width,
            height: max(viewport.height, ceil(textHeight))
        )
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor.black.withAlphaComponent(0.10).setFill()
        bounds.fill()

        let options = ComposerAccessibilityOptions.current
        let path = NSBezierPath(roundedRect: cardRect, xRadius: 10, yRadius: 10)
        NSColor.windowBackgroundColor.withAlphaComponent(0.98).setFill()
        path.fill()
        let borderColor = options.increaseContrast
            ? NSColor.labelColor.withAlphaComponent(0.30)
            : NSColor.separatorColor
        borderColor.setStroke()
        path.lineWidth = options.increaseContrast ? 1 : 0.5
        path.stroke()
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard !cardRect.contains(point) else { return }
        onDismiss?()
    }
}

/// The two-column history browser shown above the composer when the input is
/// empty and ArrowUp is pressed. The right column reuses an NSTextView so the
/// summary text can be selected and copied naturally.
///
/// The same view also hosts the expanded full-width reading layout: the list
/// and separator hide, the question moves to a card above the summary, and the
/// window grows upward. The mode and any reading snapshots live only for this
/// panel session; reopening always starts in the two-column layout.
final class PromptHistoryBrowserView: NSView {
    var onFill: (() -> Void)?
    var onCopy: (() -> Void)?
    /// Asks the controller to expand the reading view. The controller checks
    /// that the record has a summary and that the screen has room.
    var onZoomRequested: (() -> Void)?
    /// Asks the controller to return to the two-column layout.
    var onBackRequested: (() -> Void)?

    private(set) var records: [PromptHistoryRecord] = []
    private(set) var selectedIndex = 0
    private(set) var isZoomed = false
    private(set) var isQuestionOverlayVisible = false
    /// Identifies the current mode transition so a fast switch's earlier
    /// completion cannot restore positions on top of a newer layout.
    private(set) var modeTransitionGeneration = 0
    private var nowMillis: Double = PromptHistoryStore.currentMillis()

    let headerLabel = NSTextField(labelWithString: "最近 3 天提问")
    let listScrollView = NSScrollView()
    let listView = HistoryListContentView(frame: .zero)
    let summaryScrollView = NSScrollView()
    let summaryTextView = SummaryTextView()
    let fillButton = NSButton(title: "填入提问", target: nil, action: nil)
    let copyButton = NSButton(title: "复制总结", target: nil, action: nil)
    let zoomButton = NSButton(title: "放大总结", target: nil, action: nil)
    let zoomIconButton = NSButton(title: "", target: nil, action: nil)
    let backButton = NSButton(title: "返回列表", target: nil, action: nil)
    let questionCard = HistoryQuestionCardView(frame: .zero)
    let questionOverlay = HistoryQuestionOverlayView(frame: .zero)
    let hintLabel = NSTextField(labelWithString: "↑↓ 切换 · ↵ 填入 · esc 关闭")
    private let separator = HistorySeparatorView()

    private static let twoColumnHint = "↑↓ 切换 · ↵ 填入 · esc 关闭"
    private static let zoomedHint = "← / esc 返回列表 · ↑↓ 滚动 · ↵ 填入"
    /// The expanded body keeps 12pt on each side inside the 624pt panel.
    private static let zoomHorizontalInset: CGFloat = 12
    private static let questionCardHeight: CGFloat = 48

    /// The identity of the text currently in the summary viewport, so an
    /// unrelated history refresh can keep the selection and scroll position.
    private var renderedSummaryIdentity: String?

    /// Reading positions saved when leaving the two-column layout, keyed by
    /// record. Content changes or reopening the browser invalidate them.
    private struct ReadingSnapshot {
        let contentIdentity: String
        let listOrigin: NSPoint
        let summaryOrigin: NSPoint
        let selection: NSRange
    }

    private var readingSnapshots: [String: ReadingSnapshot] = [:]
    private var pendingRestoreKey: String?
    private var questionOverlayRecordKey: String?
    /// While the side column fades, the zoomed body keeps the two-column
    /// geometry so long text reflows only once, at the target width.
    private var isSideColumnTransitioning = false

    private var showsZoomedLayout: Bool {
        isZoomed && !isSideColumnTransitioning
    }

    override var isFlipped: Bool { false }
    override var acceptsFirstResponder: Bool { false }
    override var mouseDownCanMoveWindow: Bool { false }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    var selectedRecord: PromptHistoryRecord? {
        guard selectedIndex >= 0, selectedIndex < records.count else { return nil }
        return records[selectedIndex]
    }

    var canZoom: Bool {
        selectedRecord?.hasSummary == true
    }

    private func build() {
        headerLabel.font = ComposerFonts.historyBrowserHeader
        headerLabel.textColor = .secondaryLabelColor
        addSubview(headerLabel)

        listScrollView.drawsBackground = false
        listScrollView.borderType = .noBorder
        listScrollView.hasVerticalScroller = true
        listScrollView.autohidesScrollers = true
        listScrollView.focusRingType = .none
        listScrollView.documentView = listView
        listView.onSelect = { [weak self] index in
            self?.select(index)
        }
        listView.onActivate = { [weak self] index in
            self?.select(index)
            self?.onFill?()
        }
        addSubview(listScrollView)

        addSubview(separator)

        summaryTextView.font = ComposerFonts.historyBrowserBody
        summaryTextView.textColor = .labelColor
        summaryTextView.isEditable = false
        summaryTextView.isSelectable = true
        summaryTextView.drawsBackground = false
        summaryTextView.isRichText = true
        summaryTextView.focusRingType = .none
        summaryTextView.textContainerInset = NSSize(width: 4, height: 2)
        summaryTextView.isVerticallyResizable = true
        summaryTextView.isHorizontallyResizable = false
        summaryTextView.autoresizingMask = [.width]
        summaryTextView.minSize = NSSize(width: 0, height: 0)
        summaryTextView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        summaryTextView.textContainer?.widthTracksTextView = true
        summaryTextView.textContainer?.containerSize = NSSize(
            width: 0,
            height: CGFloat.greatestFiniteMagnitude
        )
        summaryTextView.textContainer?.lineFragmentPadding = 0
        summaryTextView.setAccessibilityLabel("AI 总结")
        summaryTextView.onDoubleClickToZoom = { [weak self] in
            guard let self, !self.isZoomed, self.canZoom else { return false }
            self.onZoomRequested?()
            return true
        }

        summaryScrollView.drawsBackground = false
        summaryScrollView.borderType = .noBorder
        summaryScrollView.hasVerticalScroller = true
        summaryScrollView.autohidesScrollers = true
        summaryScrollView.focusRingType = .none
        summaryScrollView.documentView = summaryTextView
        addSubview(summaryScrollView)

        for button in [fillButton, copyButton, zoomButton, backButton, zoomIconButton] {
            button.isBordered = false
            button.font = ComposerFonts.historyBrowserButton
            button.contentTintColor = ComposerTheme.accentPurple
            button.target = self
            addSubview(button)
        }
        fillButton.action = #selector(fillTapped)
        fillButton.toolTip = "把选中的问题填入输入框（不会自动发送）"
        copyButton.action = #selector(copyTapped)
        copyButton.toolTip = "复制当前 AI 总结"
        zoomButton.action = #selector(zoomTapped)
        zoomButton.toolTip = "放大展示总结全文"
        backButton.action = #selector(backTapped)
        backButton.toolTip = "返回双栏列表"
        zoomIconButton.action = #selector(zoomTapped)
        zoomIconButton.toolTip = "放大展示总结全文"
        zoomIconButton.image = NSImage(
            systemSymbolName: "arrow.up.left.and.arrow.down.right",
            accessibilityDescription: "放大展示总结全文"
        )?.withSymbolConfiguration(
            NSImage.SymbolConfiguration(pointSize: 11, weight: .medium)
        )
        zoomIconButton.imagePosition = .imageOnly
        zoomIconButton.isBordered = false

        questionCard.onOpen = { [weak self] in
            self?.showQuestionOverlay()
        }
        questionCard.isHidden = true
        addSubview(questionCard)

        hintLabel.font = ComposerFonts.historyBrowserRowMeta
        hintLabel.textColor = .tertiaryLabelColor
        addSubview(hintLabel)

        questionOverlay.onDismiss = { [weak self] in
            self?.dismissQuestionOverlay()
        }
        addSubview(questionOverlay)

        setAccessibilityRole(.group)
        setAccessibilityLabel("最近 3 天提问与 AI 总结")
        listView.setAccessibilityRole(.list)
        listView.setAccessibilityLabel("最近提问")
        fillButton.setAccessibilityLabel("填入提问")
        copyButton.setAccessibilityLabel("复制总结")
        zoomButton.setAccessibilityLabel("放大总结")
        zoomIconButton.setAccessibilityLabel("放大展示总结全文")
        backButton.setAccessibilityLabel("返回列表")
        isHidden = true
        applyModeVisibility()
    }

    override func layout() {
        super.layout()
        let width = bounds.width
        let height = bounds.height
        guard width > 0, height > 0 else { return }

        let buttonY: CGFloat = 9
        let bodyBottom = buttonY + 20 + 8
        questionOverlay.frame = bounds
        layoutFooter(width: width, buttonY: buttonY)

        let headerHeight: CGFloat
        if showsZoomedLayout {
            let questionHeight = Self.questionCardHeight
            questionCard.frame = NSRect(
                x: Self.zoomHorizontalInset,
                y: height - 10 - questionHeight,
                width: max(0, width - Self.zoomHorizontalInset * 2),
                height: questionHeight
            )
            summaryScrollView.frame = NSRect(
                x: Self.zoomHorizontalInset,
                y: bodyBottom,
                width: max(0, width - Self.zoomHorizontalInset * 2),
                height: max(0, questionCard.frame.minY - 8 - bodyBottom)
            )
            layoutSummaryDocument()
            return
        }

        headerLabel.sizeToFit()
        zoomIconButton.sizeToFit()
        headerHeight = max(14, headerLabel.frame.height)
        let iconSize = max(20, zoomIconButton.frame.height)
        zoomIconButton.frame = NSRect(
            x: width - 14 - iconSize,
            y: height - 10 - headerHeight + (headerHeight - iconSize) / 2,
            width: iconSize,
            height: iconSize
        )
        headerLabel.frame = NSRect(
            x: 14,
            y: height - 10 - headerHeight,
            width: max(0, zoomIconButton.frame.minX - 8 - 14),
            height: headerHeight
        )

        let listTop = height - 10 - headerHeight - 8
        let listHeight = max(0, listTop - bodyBottom)
        listScrollView.frame = NSRect(
            x: 10,
            y: bodyBottom,
            width: min(ComposerMetrics.historyBrowserListWidth, max(0, width - 20)),
            height: listHeight
        )
        separator.frame = NSRect(
            x: listScrollView.frame.maxX + 8,
            y: bodyBottom + 2,
            width: 1,
            height: max(0, listHeight - 4)
        )
        let summaryX = separator.frame.maxX + 10
        summaryScrollView.frame = NSRect(
            x: summaryX,
            y: bodyBottom,
            width: max(0, width - summaryX - 12),
            height: listHeight
        )
        layoutSummaryDocument()

        guard listHeight > 0 else { return }
        let listWidth = max(0, listScrollView.contentSize.width)
        listView.frame = NSRect(
            x: 0,
            y: 0,
            width: listWidth,
            height: max(listView.requiredHeight, listScrollView.contentSize.height)
        )
    }

    /// Lays out the bottom bar for the current mode: two-column shows the
    /// original fill/copy pair plus "放大总结"; the expanded view shows
    /// "返回列表" first, then copy and fill.
    private func layoutFooter(width: CGFloat, buttonY: CGFloat) {
        hintLabel.sizeToFit()
        let buttons: [NSButton] = isZoomed
            ? [backButton, copyButton, fillButton]
            : [fillButton, copyButton, zoomButton]
        var x: CGFloat = 14
        for button in buttons {
            button.sizeToFit()
            button.frame = NSRect(x: x, y: buttonY, width: button.frame.width, height: 20)
            x = button.frame.maxX + 14
        }
        let hintWidth = hintLabel.frame.width
        hintLabel.frame = NSRect(
            x: max(x - 4, width - 14 - hintWidth),
            y: buttonY + 3,
            width: hintWidth,
            height: hintLabel.frame.height
        )
    }

    /// Keeps the text view at least as large as its viewport, so a click
    /// anywhere in the right column lands on text rather than falling through
    /// to the panel background. The document grows with wrapped text so the
    /// scroll view handles long summaries.
    private func layoutSummaryDocument() {
        let viewport = summaryScrollView.contentSize
        guard viewport.width > 0, viewport.height > 0 else { return }
        summaryTextView.minSize = NSSize(width: viewport.width, height: viewport.height)
        summaryTextView.maxSize = NSSize(
            width: viewport.width,
            height: CGFloat.greatestFiniteMagnitude
        )
        guard let container = summaryTextView.textContainer,
              let layoutManager = summaryTextView.layoutManager else { return }
        container.containerSize = NSSize(
            width: viewport.width,
            height: CGFloat.greatestFiniteMagnitude
        )
        container.widthTracksTextView = true
        layoutManager.ensureLayout(for: container)
        let textHeight = layoutManager.usedRect(for: container).height
            + summaryTextView.textContainerInset.height * 2
        summaryTextView.frame = NSRect(
            x: 0,
            y: 0,
            width: viewport.width,
            height: max(viewport.height, ceil(textHeight))
        )
    }

    /// Decoration labels, the separator and the scroll containers' own blank
    /// areas would otherwise let AppKit start a window drag (or drop the click
    /// on nothing). Route those to the browser; text, rows, scrollers and
    /// buttons keep their native hit handling. The question card and overlay
    /// are interactive views of their own.
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard !isHidden else { return nil }
        guard let hit = super.hitTest(point) else { return self }
        if hit === self
            || hit === headerLabel
            || hit === hintLabel
            || hit === separator
            || hit === listScrollView
            || hit === listScrollView.contentView
            || hit === summaryScrollView
            || hit === summaryScrollView.contentView {
            return self
        }
        return hit
    }

    /// The browser owns every click inside its panel: consume the ones no
    /// subview handled so the root view never drags or dismisses the window.
    /// In the two-column layout a double click on the right column's blank
    /// space expands the reading view; otherwise the click focuses the summary.
    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard summaryScrollView.frame.contains(point) else { return }
        if !isZoomed, event.clickCount >= 2, canZoom {
            onZoomRequested?()
            return
        }
        focusSummary(at: point)
    }

    private func focusSummary(at point: NSPoint) {
        guard let window else { return }
        window.makeFirstResponder(summaryTextView)
        let local = summaryTextView.convert(point, from: self)
        let index = summaryTextView.characterIndexForInsertion(at: local)
        let range = NSRange(location: index, length: 0)
        summaryTextView.setSelectedRange(range)
        summaryTextView.scrollRangeToVisible(range)
    }

    func present(records: [PromptHistoryRecord], nowMillis: Double = PromptHistoryStore.currentMillis()) {
        self.records = records
        self.nowMillis = nowMillis
        selectedIndex = max(0, min(selectedIndex, max(0, records.count - 1)))
        isHidden = records.isEmpty
        resetReadingState()
        refresh()
    }

    func update(records: [PromptHistoryRecord], nowMillis: Double = PromptHistoryStore.currentMillis()) {
        guard !isHidden else { return }
        let previousKey = selectedRecord?.key
        self.records = records
        self.nowMillis = nowMillis
        invalidateChangedSnapshots()
        var selectionSurvived = false
        if let previousKey,
           let index = records.firstIndex(where: { $0.key == previousKey }) {
            selectedIndex = index
            selectionSurvived = true
        } else {
            selectedIndex = max(0, min(selectedIndex, max(0, records.count - 1)))
        }
        // A record that disappeared or lost its summary cannot stay expanded:
        // leave the reading view first, then render the clamped neighbour.
        if isZoomed, !selectionSurvived || selectedRecord?.hasSummary != true {
            _ = setZoomed(false)
        }
        refresh()
    }

    func dismiss() {
        isHidden = true
        resetReadingState()
    }

    func select(_ index: Int) {
        guard !records.isEmpty else { return }
        selectedIndex = max(0, min(index, records.count - 1))
        refresh()
        scrollToSelected()
    }

    func moveSelection(_ delta: Int) {
        guard !records.isEmpty else { return }
        let next = (selectedIndex + delta + records.count) % records.count
        select(next)
    }

    // MARK: - Expanded reading mode

    /// Switches layouts and returns the transition's generation. Call the
    /// window-height update, then `finishZoomTransition(generation:)` in its
    /// completion so stale animations cannot restore positions.
    @discardableResult
    func setZoomed(_ zoomed: Bool) -> Int {
        modeTransitionGeneration += 1
        let generation = modeTransitionGeneration
        guard zoomed != isZoomed else { return generation }

        if zoomed {
            saveReadingSnapshot()
            pendingRestoreKey = nil
            isZoomed = true
            dismissQuestionOverlay(refocus: false)
            // Fade the side column out first and keep the body's two-column
            // geometry until it is gone; the expanded body then reflows once
            // at its target width instead of on every animation frame.
            beginSideColumnTransition(hiding: true, generation: generation)
            applyModeVisibility()
            needsLayout = true
            refresh()
        } else {
            pendingRestoreKey = selectedRecord?.key
            isZoomed = false
            isSideColumnTransitioning = false
            dismissQuestionOverlay(refocus: false)
            applyModeVisibility()
            needsLayout = true
            refresh()
            beginSideColumnTransition(hiding: false, generation: generation)
        }
        return generation
    }

    /// Crossfades the left column and separator with the same 0.16s window
    /// animation. Reduce Motion applies the end state immediately.
    private func beginSideColumnTransition(hiding: Bool, generation: Int) {
        isSideColumnTransitioning = hiding
        listScrollView.isHidden = false
        separator.isHidden = false
        listScrollView.alphaValue = hiding ? 1 : 0
        separator.alphaValue = hiding ? 1 : 0
        guard !ComposerAccessibilityOptions.current.reduceMotion else {
            completeSideColumnTransition(hiding: hiding, generation: generation)
            return
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.16
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            listScrollView.animator().alphaValue = hiding ? 0 : 1
            separator.animator().alphaValue = hiding ? 0 : 1
        } completionHandler: { [weak self] in
            self?.completeSideColumnTransition(hiding: hiding, generation: generation)
        }
    }

    private func completeSideColumnTransition(hiding: Bool, generation: Int) {
        guard generation == modeTransitionGeneration else { return }
        listScrollView.alphaValue = 1
        separator.alphaValue = 1
        if hiding {
            guard isZoomed else { return }
            isSideColumnTransitioning = false
            applyModeVisibility()
            needsLayout = true
            refresh()
            summaryTextView.setSelectedRange(NSRange(location: 0, length: 0))
            summaryTextView.scrollToBeginningOfDocument(nil)
            layoutSubtreeIfNeeded()
        } else {
            guard !isZoomed else { return }
            isSideColumnTransitioning = false
            listScrollView.isHidden = false
            separator.isHidden = false
            applyModeVisibility()
        }
    }

    /// Restores the two-column reading position once the height animation has
    /// settled the layout for the given mode transition.
    func finishZoomTransition(generation: Int) {
        guard generation == modeTransitionGeneration, !isZoomed else { return }
        guard let key = pendingRestoreKey else { return }
        pendingRestoreKey = nil
        layoutSubtreeIfNeeded()
        restoreReadingSnapshot(for: key)
    }

    /// Scrolls the expanded body by one line or one viewport, clamped to its
    /// bounds. The selection and the selected record are left untouched.
    func scrollSummary(up: Bool, byPage: Bool) {
        guard isZoomed else { return }
        let lineHeight = summaryLineHeight()
        let viewportHeight = summaryScrollView.contentSize.height
        let delta = byPage ? max(lineHeight, viewportHeight - lineHeight * 2) : lineHeight
        scrollSummary(toY: summaryScrollView.contentView.bounds.origin.y + (up ? -delta : delta))
    }

    private func summaryLineHeight() -> CGFloat {
        let font = summaryTextView.font ?? ComposerFonts.historyBrowserBody
        return ceil(summaryTextView.layoutManager?.defaultLineHeight(for: font) ?? 17)
    }

    private func scrollSummary(toY value: CGFloat) {
        let content = summaryScrollView.contentView
        var proposed = content.bounds
        proposed.origin.y = value
        // Let the clip view apply its own document bounds (including any
        // scroller and inset adjustments) instead of guessing the maximum.
        content.scroll(to: content.constrainBoundsRect(proposed).origin)
        summaryScrollView.reflectScrolledClipView(content)
    }

    // MARK: - Full-question overlay

    func showQuestionOverlay() {
        guard isZoomed, let record = selectedRecord else { return }
        isQuestionOverlayVisible = true
        questionOverlayRecordKey = record.key
        questionOverlay.frame = bounds
        questionOverlay.present(question: record.text)
        needsLayout = true
        layoutSubtreeIfNeeded()
        window?.makeFirstResponder(questionOverlay.textView)
    }

    func dismissQuestionOverlay(refocus: Bool = true) {
        guard isQuestionOverlayVisible else { return }
        isQuestionOverlayVisible = false
        questionOverlayRecordKey = nil
        questionOverlay.isHidden = true
        if refocus, isZoomed, !isHidden {
            window?.makeFirstResponder(questionCard)
        }
    }

    func applyAccessibilityOptions() {
        let options = ComposerAccessibilityOptions.current
        hintLabel.textColor = options.increaseContrast
            ? .secondaryLabelColor
            : .tertiaryLabelColor
        let tint = options.increaseContrast ? NSColor.labelColor : ComposerTheme.accentPurple
        for button in [fillButton, copyButton, zoomButton, backButton, zoomIconButton] {
            button.contentTintColor = tint
        }
        separator.needsDisplay = true
        listView.needsDisplay = true
        questionCard.needsDisplay = true
        questionOverlay.refreshAppearance()
    }

    // MARK: - Reading state internals

    private func resetReadingState() {
        modeTransitionGeneration += 1
        readingSnapshots.removeAll()
        pendingRestoreKey = nil
        isZoomed = false
        isSideColumnTransitioning = false
        listScrollView.alphaValue = 1
        separator.alphaValue = 1
        dismissQuestionOverlay(refocus: false)
        renderedSummaryIdentity = nil
        summaryTextView.setSelectedRange(NSRange(location: 0, length: 0))
        applyModeVisibility()
    }

    private func applyModeVisibility() {
        let zoomedLayout = showsZoomedLayout
        headerLabel.isHidden = zoomedLayout
        listScrollView.isHidden = zoomedLayout
        separator.isHidden = zoomedLayout
        questionCard.isHidden = !zoomedLayout
        // The bottom bar and the expand icon follow the target mode right
        // away, so the available action is clear during the column fade.
        zoomIconButton.isHidden = isZoomed
        zoomButton.isHidden = isZoomed
        backButton.isHidden = !isZoomed
        hintLabel.stringValue = isZoomed ? Self.zoomedHint : Self.twoColumnHint
        hintLabel.setAccessibilityLabel(hintLabel.stringValue)
    }

    private func saveReadingSnapshot() {
        guard !isZoomed, let key = selectedRecord?.key else { return }
        readingSnapshots[key] = ReadingSnapshot(
            contentIdentity: contentIdentity(for: selectedRecord),
            listOrigin: listScrollView.contentView.bounds.origin,
            summaryOrigin: summaryScrollView.contentView.bounds.origin,
            selection: summaryTextView.selectedRange()
        )
    }

    private func restoreReadingSnapshot(for key: String) {
        guard let snapshot = readingSnapshots[key],
              selectedRecord?.key == key,
              snapshot.contentIdentity == contentIdentity(for: selectedRecord) else { return }
        summaryTextView.setSelectedRange(
            clamped(snapshot.selection, to: summaryTextView.string.utf16.count)
        )
        scrollView(listScrollView, to: snapshot.listOrigin)
        scrollView(summaryScrollView, to: snapshot.summaryOrigin)
    }

    private func clamped(_ range: NSRange, to length: Int) -> NSRange {
        let location = min(max(0, range.location), length)
        let clippedLength = min(max(0, range.length), length - location)
        return NSRange(location: location, length: clippedLength)
    }

    private func scrollView(_ scrollView: NSScrollView, to origin: NSPoint) {
        let content = scrollView.contentView
        var proposed = content.bounds
        proposed.origin = origin
        content.scroll(to: content.constrainBoundsRect(proposed).origin)
        scrollView.reflectScrolledClipView(content)
    }

    /// A refresh that changes a record's question or summary drops its saved
    /// reading position; the current layout then resets from the top.
    private func invalidateChangedSnapshots() {
        guard !readingSnapshots.isEmpty else { return }
        var identities: [String: String] = [:]
        for record in records {
            identities[record.key] = contentIdentity(for: record)
        }
        readingSnapshots = readingSnapshots.filter { key, snapshot in
            identities[key] == snapshot.contentIdentity
        }
    }

    private func refresh() {
        listView.update(records: records, selectedIndex: selectedIndex, nowMillis: nowMillis)
        needsLayout = true
        renderSummary()
        updateActionState()
        updateQuestionCard()
        if isQuestionOverlayVisible, questionOverlayRecordKey != selectedRecord?.key {
            dismissQuestionOverlay(refocus: false)
        }
        scrollToSelected()
    }

    private func updateActionState() {
        let record = selectedRecord
        fillButton.isEnabled = record != nil
        let summaryEnabled = record?.hasSummary == true
        copyButton.isEnabled = summaryEnabled
        zoomButton.isEnabled = summaryEnabled
        zoomIconButton.isEnabled = summaryEnabled
    }

    private func updateQuestionCard() {
        guard let record = selectedRecord else {
            questionCard.update(question: "暂无最近提问", time: "")
            return
        }
        questionCard.update(
            question: record.text,
            time: historyTimestampText(millis: record.updatedAtMillis, nowMillis: nowMillis)
        )
    }

    private func scrollToSelected() {
        guard !records.isEmpty, !isZoomed else { return }
        let rect = NSRect(
            x: 0,
            y: 4 + CGFloat(selectedIndex) * listView.rowHeight,
            width: listView.bounds.width,
            height: listView.rowHeight
        )
        listView.scrollToVisible(rect)
    }

    /// Replaces the summary column only when the shown question or summary
    /// actually changed, so a background history refresh keeps the reader's
    /// selection and scroll position. Switching records resets both.
    private func renderSummary() {
        let record = selectedRecord
        let identity = summaryIdentity(for: record)
        guard identity != renderedSummaryIdentity else { return }
        renderedSummaryIdentity = identity

        summaryTextView.textStorage?.setAttributedString(attributedSummary(for: record))
        summaryTextView.setSelectedRange(NSRange(location: 0, length: 0))
        layoutSummaryDocument()
        summaryTextView.scrollToBeginningOfDocument(nil)
    }

    private func summaryIdentity(for record: PromptHistoryRecord?) -> String {
        contentIdentity(for: record) + (showsZoomedLayout ? "\u{1}zoom" : "\u{1}columns")
    }

    private func contentIdentity(for record: PromptHistoryRecord?) -> String {
        guard let record else { return "<no-record>" }
        return [record.key, record.text, record.summary?.formattedText ?? ""]
            .joined(separator: "\u{1}")
    }

    private func attributedSummary(for record: PromptHistoryRecord?) -> NSAttributedString {
        guard let record else { return summaryPlaceholder("暂无最近提问") }
        guard let summary = record.summary, record.hasSummary else {
            return summaryPlaceholder("暂无总结")
        }
        let text = NSMutableAttributedString()
        // The expanded view shows the question in its own top card; the
        // two-column layout keeps the compact prefix above the body.
        if !showsZoomedLayout {
            let question = NSAttributedString(
                string: record.text.replacingOccurrences(of: "\n", with: " ") + "\n\n",
                attributes: [
                    .font: ComposerFonts.historyBrowserRowMeta,
                    .foregroundColor: NSColor.tertiaryLabelColor
                ]
            )
            text.append(question)
        }
        // formattedText already carries the extension's source labels, which
        // stay anonymous in blind mode. It is rendered verbatim here; the app
        // must not invent or rewrite provider names.
        text.append(renderSummaryBody(summary.formattedText))
        return text
    }

    private func summaryPlaceholder(_ value: String) -> NSAttributedString {
        NSAttributedString(
            string: value,
            attributes: [
                .font: ComposerFonts.historyBrowserBody,
                .foregroundColor: NSColor.tertiaryLabelColor
            ]
        )
    }

    /// A deliberately small Markdown pass: bold headings and indented bullets,
    /// body text otherwise. No external renderer is needed for the formatter's
    /// plain-text output.
    private func renderSummaryBody(_ value: String) -> NSAttributedString {
        let result = NSMutableAttributedString()
        let body = ComposerFonts.historyBrowserBody
        let heading = ComposerFonts.historyBrowserHeading

        for line in value.components(separatedBy: "\n") {
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineSpacing = 2
            paragraph.paragraphSpacing = 3
            var text = line
            var attributes: [NSAttributedString.Key: Any] = [
                .font: body,
                .foregroundColor: NSColor.labelColor,
                .paragraphStyle: paragraph
            ]
            if line.hasPrefix("## ") {
                text = String(line.dropFirst(3))
                attributes[.font] = heading
            } else if line.hasPrefix("- ") || line.hasPrefix("  · ") {
                text = "  • " + line
                    .replacingOccurrences(of: "- ", with: "", options: [.anchored])
                    .replacingOccurrences(of: "  · ", with: "", options: [.anchored])
                    .trimmingCharacters(in: .whitespaces)
                paragraph.headIndent = 12
                paragraph.firstLineHeadIndent = 2
            } else if line.count <= 60, line.hasSuffix(":") {
                attributes[.font] = heading
            }
            result.append(NSAttributedString(string: text + "\n", attributes: attributes))
        }
        return result
    }

    @objc private func fillTapped() {
        onFill?()
    }

    @objc private func copyTapped() {
        onCopy?()
    }

    @objc private func zoomTapped() {
        onZoomRequested?()
    }

    @objc private func backTapped() {
        onBackRequested?()
    }
}