import CoreGraphics
import Foundation

public func composerOrigin(visibleFrame: CGRect, panelSize: CGSize) -> CGPoint {
    CGPoint(
        x: visibleFrame.midX - panelSize.width / 2,
        y: visibleFrame.minY + visibleFrame.height * 0.28
    )
}

public enum ShortcutChoice: String, CaseIterable {
    case optionSpace
    case commandShiftSpace

    public static let defaultsKey = "globalShortcut"
    public static let fallback: ShortcutChoice = .optionSpace

    public var title: String {
        switch self {
        case .optionSpace:
            return "⌥ Space"
        case .commandShiftSpace:
            return "⌘ ⇧ Space"
        }
    }

    public var detail: String {
        switch self {
        case .optionSpace:
            return "Option + Space（默认）"
        case .commandShiftSpace:
            return "Command + Shift + Space"
        }
    }

    public static func load(from defaults: UserDefaults = .standard) -> ShortcutChoice {
        guard let raw = defaults.string(forKey: defaultsKey),
              let choice = ShortcutChoice(rawValue: raw) else {
            return fallback
        }
        return choice
    }

    public func save(to defaults: UserDefaults = .standard) {
        defaults.set(rawValue, forKey: Self.defaultsKey)
    }
}