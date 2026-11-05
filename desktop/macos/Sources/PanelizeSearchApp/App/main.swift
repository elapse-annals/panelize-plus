import AppKit
import PanelizeSearchCore

let application = NSApplication.shared
// An isolated instance (custom bridge support directory) intentionally runs
// beside the installed client; the normal client keeps its single-instance
// behavior and just raises the running copy.
let isolationOverride = ProcessInfo.processInfo.environment[
    BridgeProtocol.supportDirectoryOverrideKey
] ?? ""
if isolationOverride.isEmpty {
    let existing = NSRunningApplication
        .runningApplications(withBundleIdentifier: BridgeProtocol.appBundleIdentifier)
        .first { $0.processIdentifier != getpid() }
    if let existing {
        existing.activate(options: [.activateAllWindows])
        exit(EXIT_SUCCESS)
    }
}

application.setActivationPolicy(.accessory)
let delegate = AppDelegate()
application.delegate = delegate
application.run()