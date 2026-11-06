import Foundation

/// The prompt mode applied to one prompt sent from the macOS client. Raw
/// values are the wire contract shared with the extension; `defaultMode` is
/// an explicit "append nothing" choice, while a missing value lets the
/// extension keep its own selected mode.
public enum PromptModeChoice: String, CaseIterable {
    case defaultMode = "default"
    case auto
    case concise
    case learning
    case compete
    case brainstorm
    case deep

    public static let defaultsKey = "promptMode"
    public static let fallback: PromptModeChoice = .auto
    public static let fallbackSymbolName = "sparkles"
    public static let autoDefaultMigrationKey = "promptModeAutoDefaultApplied"

    /// Existing installs move to Auto once, so the picker starts where the
    /// product default says it should. A mode chosen afterwards still wins.
    public static func applyAutoDefaultMigrationIfNeeded(from defaults: UserDefaults = .standard) {
        guard !defaults.bool(forKey: autoDefaultMigrationKey) else { return }
        defaults.set(true, forKey: autoDefaultMigrationKey)
        if defaults.string(forKey: defaultsKey) != nil {
            PromptModeChoice.auto.save(to: defaults)
        }
    }

    /// The localized mode name from the extension's locale files.
    public func title(in language: PromptTextLanguage = .current) -> String {
        PromptModeDefinitions.titles[self]?.text(in: language) ?? rawValue
    }

    /// The localized mode name in the current system language.
    public var title: String {
        title()
    }

    /// The SF Symbol that stands for this mode's meaning. Auto keeps the
    /// picker's original sparkles so the default choice stays recognizable.
    public var symbolName: String {
        switch self {
        case .defaultMode:
            return "minus.circle"
        case .auto:
            return Self.fallbackSymbolName
        case .concise:
            return "list.bullet"
        case .learning:
            return "graduationcap"
        case .compete:
            return "exclamationmark.bubble"
        case .brainstorm:
            return "lightbulb"
        case .deep:
            return "brain.head.profile"
        }
    }

    /// The localized explanation shown in the menu, below the picker and in
    /// the picker's tooltip.
    public func hint(in language: PromptTextLanguage = .current) -> String {
        PromptModeDefinitions.hints[self]?.text(in: language) ?? ""
    }

    /// The explanation in the current system language.
    public var hint: String {
        hint()
    }

    /// The explanation in the current system language.
    public var detail: String {
        hint()
    }

    public static func load(from defaults: UserDefaults = .standard) -> PromptModeChoice {
        guard let raw = defaults.string(forKey: defaultsKey),
              let choice = PromptModeChoice(rawValue: raw) else {
            return fallback
        }
        return choice
    }

    public func save(to defaults: UserDefaults = .standard) {
        defaults.set(rawValue, forKey: Self.defaultsKey)
    }

    /// The next mode in picker order. Cycling wraps at either end, so Tab and
    /// Shift+Tab reach every mode without opening the menu.
    public func cycled(forward: Bool = true) -> PromptModeChoice {
        let all = Self.allCases
        guard let index = all.firstIndex(of: self) else {
            return Self.fallback
        }
        let offset = forward ? 1 : all.count - 1
        return all[(index + offset) % all.count]
    }

    /// Only a whitelisted wire value is accepted; missing or invalid values
    /// leave the extension's own mode in effect.
    public static func wireValue(from message: [String: Any]) -> PromptModeChoice? {
        guard let raw = message["promptMode"] as? String else {
            return nil
        }
        return PromptModeChoice(rawValue: raw)
    }
}
