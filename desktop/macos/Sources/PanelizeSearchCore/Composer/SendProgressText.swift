import Foundation

/// The macOS composer's copy for a send in progress. The status row carries
/// the counts; the preview row names the AIs still being waited for while the
/// prompt is being sent. Blind mode shows counts only.
public enum SendProgressText {
    /// How many names fit the one-line preview before the rest are counted.
    public static let visibleNameLimit = 2

    public static func status(for progress: SendProgress) -> String {
        switch progress.stage {
        case .opening:
            return "正在打开 AI 面板…"
        case .preparing:
            // No known panel count: never show a made-up ratio.
            guard progress.total > 0 else { return "正在准备 AI…" }
            return "AI 准备中：\(min(progress.ready, progress.total))/\(progress.total)"
        case .sending:
            return "正在发送…"
        }
    }

    /// The preview row text, with long name lists shortened. `nil` leaves the
    /// prompt-mode preview in place (opening and preparing).
    public static func preview(for progress: SendProgress) -> String? {
        guard progress.stage == .sending else { return nil }
        return line(for: progress, full: false)
    }

    /// The untruncated preview text for the tooltip and accessibility value.
    public static func fullPreview(for progress: SendProgress) -> String? {
        guard progress.stage == .sending else { return nil }
        return line(for: progress, full: true)
    }

    private static func line(for progress: SendProgress, full: Bool) -> String? {
        if progress.blind {
            if progress.pendingCount > 0 {
                return "等待：\(progress.pendingCount) 个 AI"
            }
            if progress.timedOutCount > 0 {
                return "未就绪：\(progress.timedOutCount) 个 AI"
            }
            return nil
        }

        if !progress.pendingNames.isEmpty {
            return names(prefix: "等待：", values: progress.pendingNames, full: full)
        }
        if progress.pendingCount > 0 {
            return "等待：\(progress.pendingCount) 个 AI"
        }
        if !progress.timedOutNames.isEmpty {
            return names(prefix: "未就绪：", values: progress.timedOutNames, full: full)
        }
        if progress.timedOutCount > 0 {
            return "未就绪：\(progress.timedOutCount) 个 AI"
        }
        return nil
    }

    private static func names(prefix: String, values: [String], full: Bool) -> String {
        if full || values.count <= visibleNameLimit {
            return prefix + values.joined(separator: "、")
        }
        return prefix
            + values.prefix(visibleNameLimit).joined(separator: "、")
            + " 等 \(values.count) 个"
    }
}