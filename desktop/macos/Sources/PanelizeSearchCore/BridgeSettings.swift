import Foundation

/// Locates the Panelize extension's settings page so the client can take the
/// user straight to the switch that turns on the global input bridge.
public enum BridgeSettings {
    public static let optionsPagePath = "options/options.html"
    public static let bridgeSwitchFragment = "global-send-bridge-toggle"

    /// Chrome extension IDs are 32 characters drawn from a–p.
    public static func isValidExtensionID(_ value: String) -> Bool {
        value.count == 32 && value.allSatisfy { ("a"..."p").contains($0) }
    }

    /// Reads the extension ID from an installed Native Messaging host manifest.
    /// The manifest is written by the installer and only allows one origin.
    public static func extensionID(fromHostManifest data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let manifest = object as? [String: Any],
              let origins = manifest["allowed_origins"] as? [String] else {
            return nil
        }
        let prefix = "chrome-extension://"
        for origin in origins {
            guard origin.hasPrefix(prefix), origin.hasSuffix("/") else {
                continue
            }
            let id = String(origin.dropFirst(prefix.count).dropLast())
            if isValidExtensionID(id) {
                return id
            }
        }
        return nil
    }

    public static func optionsURL(extensionID: String) -> URL? {
        guard isValidExtensionID(extensionID) else {
            return nil
        }
        return URL(
            string: "chrome-extension://\(extensionID)/\(optionsPagePath)#\(bridgeSwitchFragment)"
        )
    }
}