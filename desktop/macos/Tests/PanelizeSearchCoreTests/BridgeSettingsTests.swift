import XCTest
@testable import PanelizeSearchCore

final class BridgeSettingsTests: XCTestCase {
    func testReadsExtensionIDFromNativeHostManifest() {
        let id = "iokalaafkmjffolodkkgbbccmofbglii"
        let data = Data("""
        {
          "name": "com.panelize.global_sender",
          "type": "stdio",
          "allowed_origins": ["chrome-extension://\(id)/"]
        }
        """.utf8)

        XCTAssertEqual(BridgeSettings.extensionID(fromHostManifest: data), id)
    }

    func testRejectsMalformedManifests() {
        let invalidOrigins = [
            "https://example.com/",
            "chrome-extension://short/",
            "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/",
            "chrome-extension://iokalaafkmjffolodkkgbbccmofbglii"
        ]
        for origin in invalidOrigins {
            let data = Data("""
            { "allowed_origins": ["\(origin)"] }
            """.utf8)
            XCTAssertNil(
                BridgeSettings.extensionID(fromHostManifest: data),
                "Expected \(origin) to be rejected"
            )
        }

        XCTAssertNil(BridgeSettings.extensionID(fromHostManifest: Data("not json".utf8)))
        XCTAssertNil(BridgeSettings.extensionID(fromHostManifest: Data("{}".utf8)))
    }

    func testBuildsOptionsURLAtTheBridgeSwitch() throws {
        let id = "abcdefghijklmnopabcdefghijklmnop"
        let url = try XCTUnwrap(BridgeSettings.optionsURL(extensionID: id))
        XCTAssertEqual(
            url.absoluteString,
            "chrome-extension://\(id)/options/options.html#global-send-bridge-toggle"
        )
        XCTAssertNil(BridgeSettings.optionsURL(extensionID: "invalid"))
    }
}