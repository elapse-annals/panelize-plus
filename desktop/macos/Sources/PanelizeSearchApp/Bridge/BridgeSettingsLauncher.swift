import AppKit
import PanelizeSearchCore

/// Opens the extension's settings page at the global-input bridge switch.
/// The installed Native Messaging manifest names both the browser and the
/// extension ID, so the app never guesses a browser URL.
enum BridgeSettingsLauncher {
    private struct Browser {
        let bundleIdentifier: String
        let manifestDirectory: String
    }

    private static let browsers = [
        Browser(
            bundleIdentifier: "com.google.Chrome",
            manifestDirectory: "Google/Chrome/NativeMessagingHosts"
        ),
        Browser(
            bundleIdentifier: "com.microsoft.edgemac",
            manifestDirectory: "Microsoft Edge/NativeMessagingHosts"
        )
    ]

    /// Returns false when no installed host manifest names a valid extension,
    /// which means the native bridge itself is not set up yet.
    @discardableResult
    static func openBridgeSettings(fileManager: FileManager = .default) -> Bool {
        guard let support = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            return false
        }

        // Prefer the browser the user already has open; otherwise fall back to
        // whichever browser has the host manifest.
        let running = Set(NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier))
        let ordered = browsers.filter { running.contains($0.bundleIdentifier) }
            + browsers.filter { !running.contains($0.bundleIdentifier) }

        for browser in ordered {
            guard NSWorkspace.shared.urlForApplication(
                withBundleIdentifier: browser.bundleIdentifier
            ) != nil else {
                continue
            }
            let manifestURL = support
                .appendingPathComponent(browser.manifestDirectory)
                .appendingPathComponent("\(BridgeProtocol.hostName).json")
            guard let data = try? Data(contentsOf: manifestURL),
                  let extensionID = BridgeSettings.extensionID(fromHostManifest: data),
                  let url = BridgeSettings.optionsURL(extensionID: extensionID) else {
                continue
            }
            if launch(url, in: browser.bundleIdentifier) {
                return true
            }
        }
        return false
    }

    /// `open -b` delivers the chrome-extension URL to the browser the same way
    /// `open` does; NSWorkspace alone does not know that scheme.
    private static func launch(_ url: URL, in bundleIdentifier: String) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-b", bundleIdentifier, url.absoluteString]
        do {
            try process.run()
        } catch {
            return false
        }
        process.waitUntilExit()
        return process.terminationStatus == 0
    }
}