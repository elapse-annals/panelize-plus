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

/// The two-column history browser shown above the composer when the input is
/// empty and ArrowUp is pressed. The right column reuses an NSTextView so the
/// summary text can be selected and copied naturally.
final class PromptHistoryBrowserView: NSView {
    var onFill: (() -> Void)?
    var onCopy: (() -> Void)?

    private(set) var records: [PromptHistoryRecord] = []
    private(set) var selectedIndex = 0
    private var nowMillis: Double = PromptHistoryStore.currentMillis()

    let headerLabel = NSTextField(labelWithString: "最近 3 天提问")
    let listScrollView = NSScrollView()
    let listView = HistoryListContentView(frame: .zero)
    let summaryScrollView = NSScrollView()
    let summaryTextView = NSTextView()
    let fillButton = NSButton(title: "填入提问", target: nil, action: nil)
    let copyButton = NSButton(title: "复制总结", target: nil, action: nil)
    let hintLabel = NSTextField(labelWithString: "↑↓ 切换 · ↵ 填入 · esc 关闭")
    private let separator = NSBox()
    /// The identity of the text currently in the summary viewport, so an
    /// unrelated history refresh can keep the selection and scroll position.
    private var renderedSummaryIdentity: String?

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

        separator.boxType = .separator
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

        summaryScrollView.drawsBackground = false
        summaryScrollView.borderType = .noBorder
        summaryScrollView.hasVerticalScroller = true
        summaryScrollView.autohidesScrollers = true
        summaryScrollView.focusRingType = .none
        summaryScrollView.documentView = summaryTextView
        addSubview(summaryScrollView)

        for button in [fillButton, copyButton] {
            button.isBordered = false
            button.font = ComposerFonts.historyBrowserButton
            button.contentTintColor = ComposerTheme.accentPurple
            addSubview(button)
        }
        fillButton.target = self
        fillButton.action = #selector(fillTapped)
        fillButton.toolTip = "把选中的问题填入输入框（不会自动发送）"
        copyButton.target = self
        copyButton.action = #selector(copyTapped)
        copyButton.toolTip = "复制当前 AI 总结"

        hintLabel.font = ComposerFonts.historyBrowserRowMeta
        hintLabel.textColor = .tertiaryLabelColor
        addSubview(hintLabel)

        setAccessibilityRole(.group)
        setAccessibilityLabel("最近 3 天提问与 AI 总结")
        listView.setAccessibilityRole(.list)
        listView.setAccessibilityLabel("最近提问")
        fillButton.setAccessibilityLabel("填入提问")
        copyButton.setAccessibilityLabel("复制总结")
        isHidden = true
    }

    override func layout() {
        super.layout()
        let width = bounds.width
        let height = bounds.height
        guard width > 0, height > 0 else { return }

        headerLabel.sizeToFit()
        let headerHeight = max(14, headerLabel.frame.height)
        headerLabel.frame = NSRect(
            x: 14,
            y: height - 10 - headerHeight,
            width: max(0, width - 28),
            height: headerHeight
        )

        fillButton.sizeToFit()
        copyButton.sizeToFit()
        hintLabel.sizeToFit()
        let buttonY: CGFloat = 9
        fillButton.frame = NSRect(x: 14, y: buttonY, width: fillButton.frame.width, height: 20)
        copyButton.frame = NSRect(
            x: fillButton.frame.maxX + 14,
            y: buttonY,
            width: copyButton.frame.width,
            height: 20
        )
        hintLabel.frame = NSRect(
            x: max(copyButton.frame.maxX + 10, width - 14 - hintLabel.frame.width),
            y: buttonY + 3,
            width: hintLabel.frame.width,
            height: hintLabel.frame.height
        )

        let listTop = height - 10 - headerHeight - 8
        let listBottom = buttonY + 20 + 8
        let listHeight = max(0, listTop - listBottom)
        listScrollView.frame = NSRect(
            x: 10,
            y: listBottom,
            width: min(ComposerMetrics.historyBrowserListWidth, max(0, width - 20)),
            height: listHeight
        )
        separator.frame = NSRect(
            x: listScrollView.frame.maxX + 8,
            y: listBottom + 2,
            width: 1,
            height: max(0, listHeight - 4)
        )
        let summaryX = separator.frame.maxX + 10
        summaryScrollView.frame = NSRect(
            x: summaryX,
            y: listBottom,
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
    /// buttons keep their native hit handling.
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
    /// A click in the right column's blank space focuses the summary there.
    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard summaryScrollView.frame.contains(point) else { return }
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
        // Reopening starts from a clean selection and scroll position.
        renderedSummaryIdentity = nil
        summaryTextView.setSelectedRange(NSRange(location: 0, length: 0))
        refresh()
    }

    func update(records: [PromptHistoryRecord], nowMillis: Double = PromptHistoryStore.currentMillis()) {
        guard !isHidden else { return }
        let selectedKey = selectedRecord?.key
        self.records = records
        self.nowMillis = nowMillis
        if let selectedKey,
           let index = records.firstIndex(where: { $0.key == selectedKey }) {
            selectedIndex = index
        } else {
            selectedIndex = max(0, min(selectedIndex, max(0, records.count - 1)))
        }
        refresh()
    }

    func dismiss() {
        isHidden = true
        renderedSummaryIdentity = nil
        summaryTextView.setSelectedRange(NSRange(location: 0, length: 0))
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

    private func refresh() {
        listView.update(records: records, selectedIndex: selectedIndex, nowMillis: nowMillis)
        needsLayout = true
        renderSummary()
        fillButton.isEnabled = selectedRecord != nil
        copyButton.isEnabled = selectedRecord?.hasSummary == true
        scrollToSelected()
    }

    private func scrollToSelected() {
        guard !records.isEmpty else { return }
        let rect = NSRect(
            x: 0,
            y: 4 + CGFloat(selectedIndex) * listView.rowHeight,
            width: listView.bounds.width,
            height: listView.rowHeight
        )
        listView.scrollToVisible(rect)
    }

    /// Replaces the right column only when the shown question or summary
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
        let question = NSAttributedString(
            string: record.text.replacingOccurrences(of: "\n", with: " ") + "\n\n",
            attributes: [
                .font: ComposerFonts.historyBrowserRowMeta,
                .foregroundColor: NSColor.tertiaryLabelColor
            ]
        )
        text.append(question)
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
}