import Foundation

/// Persisted checkbox state: keep creating a fresh conversation for each round
/// until the user unchecks it.
public struct NewChatPreference {
    public static let defaultsKey = "newChatForAllPanels"

    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = NewChatPreference.defaultsKey) {
        self.defaults = defaults
        self.key = key
    }

    public func load() -> Bool {
        defaults.bool(forKey: key)
    }

    public func save(_ enabled: Bool) {
        defaults.set(enabled, forKey: key)
    }
}

/// The desktop side of the new-chat handshake. The extension ultimately decides
/// whether a reset is needed; this state only keeps the checkbox UI honest and
/// avoids starting two requests while one is in flight.
public struct NewChatState {
    public enum Phase: Equatable {
        case idle
        case requesting(String)
        case prepared
        case failed(String)
    }

    public private(set) var enabled: Bool
    public private(set) var phase: Phase

    public init(enabled: Bool = false, phase: Phase = .idle) {
        self.enabled = enabled
        self.phase = phase
    }

    public var isRequesting: Bool {
        if case .requesting = phase { return true }
        return false
    }

    public var isPrepared: Bool {
        phase == .prepared
    }

    public var requestId: String? {
        if case let .requesting(id) = phase { return id }
        return nil
    }

    /// True when opening the composer should start a reset in the background.
    public var shouldPrepareOnShow: Bool {
        enabled && !isRequesting && !isPrepared
    }

    public mutating func setEnabled(_ enabled: Bool) {
        self.enabled = enabled
        if !enabled {
            phase = .idle
        }
    }

    /// Starts a request if the checkbox is on and no fresh session is pending.
    public mutating func prepareIfNeeded(requestId: String) -> Bool {
        guard shouldPrepareOnShow else { return false }
        phase = .requesting(requestId)
        return true
    }

    /// Ignores results belonging to an older (or cancelled) request.
    @discardableResult
    public mutating func completeRequest(
        _ requestId: String,
        ok: Bool,
        ready: Int,
        total: Int
    ) -> Bool {
        guard case let .requesting(current) = phase, current == requestId else {
            return false
        }
        phase = ok && total > 0 && ready >= total ? .prepared : .failed("partial")
        return true
    }

    @discardableResult
    public mutating func failRequest(_ requestId: String, reason: String = "") -> Bool {
        guard case let .requesting(current) = phase, current == requestId else {
            return false
        }
        phase = .failed(reason)
        return true
    }

    /// A send consumes the prepared session; the next round needs a new reset.
    public mutating func sendSucceeded() {
        phase = .idle
    }

    /// The native bridge went away while a request was in flight.
    public mutating func connectionLost() {
        if case .requesting = phase {
            phase = .failed("not-connected")
        }
    }
}