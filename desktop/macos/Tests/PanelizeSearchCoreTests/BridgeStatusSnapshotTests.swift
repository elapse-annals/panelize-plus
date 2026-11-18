import XCTest
@testable import PanelizeSearchCore

final class BridgeStatusSnapshotTests: XCTestCase {
    func testDisconnectedSnapshot() {
        let snapshot = BridgeStatusSnapshot.make(
            hostConnected: false,
            extensionConnected: false,
            extensionVersion: "",
            clientVersion: "2.95.0"
        )

        XCTAssertFalse(snapshot.ready)
        XCTAssertEqual(snapshot.text, "浏览器未连接")
        XCTAssertEqual(snapshot.menuTitle, "浏览器：未连接")
        XCTAssertEqual(snapshot.compatibility, .unknown)
        XCTAssertNil(snapshot.versionHint)
    }

    func testHostOnlySnapshotWaitsForTheExtension() {
        let snapshot = BridgeStatusSnapshot.make(
            hostConnected: true,
            extensionConnected: false,
            extensionVersion: "",
            clientVersion: "2.95.0"
        )

        XCTAssertFalse(snapshot.ready)
        XCTAssertEqual(snapshot.text, "原生桥已连接，等待扩展")
        XCTAssertEqual(snapshot.menuTitle, "浏览器：等待扩展")
    }

    func testConnectedExtensionWithoutVersionHasNoHint() {
        let snapshot = BridgeStatusSnapshot.make(
            hostConnected: true,
            extensionConnected: true,
            extensionVersion: "",
            clientVersion: "2.95.0"
        )

        XCTAssertTrue(snapshot.ready)
        XCTAssertEqual(snapshot.text, "Panelize 已连接")
        XCTAssertEqual(snapshot.menuTitle, "浏览器：已连接")
        XCTAssertEqual(snapshot.compatibility, .unknown)
        XCTAssertNil(snapshot.versionHint)
    }

    func testPatchDifferenceStaysCompatibleAndQuiet() {
        let snapshot = BridgeStatusSnapshot.make(
            hostConnected: true,
            extensionConnected: true,
            extensionVersion: "2.95.1",
            clientVersion: "2.95.0"
        )

        XCTAssertEqual(snapshot.text, "Panelize 2.95.1 已连接")
        XCTAssertEqual(snapshot.menuTitle, "浏览器：已连接 (v2.95.1)")
        XCTAssertEqual(snapshot.compatibility, .compatible)
        XCTAssertNil(snapshot.versionHint)
    }

    func testVersionPrefixIsNotDoubledInTheMenuTitle() {
        let snapshot = BridgeStatusSnapshot.make(
            hostConnected: true,
            extensionConnected: true,
            extensionVersion: "v2.95.0",
            clientVersion: "2.95.0"
        )

        XCTAssertEqual(snapshot.menuTitle, "浏览器：已连接 (v2.95.0)")
        XCTAssertEqual(snapshot.text, "Panelize 2.95.0 已连接")
    }

    func testOlderExtensionShowsAMinorHintInTheMenu() {
        let snapshot = BridgeStatusSnapshot.make(
            hostConnected: true,
            extensionConnected: true,
            extensionVersion: "2.94.1",
            clientVersion: "2.95.0"
        )

        XCTAssertTrue(snapshot.ready)
        XCTAssertEqual(snapshot.compatibility, .minor)
        XCTAssertEqual(snapshot.versionHint, "扩展版本较旧，建议更新")
        XCTAssertEqual(
            snapshot.menuTitle,
            "浏览器：已连接 (v2.94.1) · 扩展版本较旧，建议更新"
        )
    }

    func testOlderClientShowsTheOppositeHint() {
        let snapshot = BridgeStatusSnapshot.make(
            hostConnected: true,
            extensionConnected: true,
            extensionVersion: "2.95.0",
            clientVersion: "2.94.1"
        )

        XCTAssertEqual(snapshot.versionHint, "macOS 客户端版本较旧，建议更新")
        XCTAssertTrue(snapshot.menuTitle.contains("macOS 客户端版本较旧"))
    }

    func testMajorDifferenceShowsAStrongerHint() {
        let snapshot = BridgeStatusSnapshot.make(
            hostConnected: true,
            extensionConnected: true,
            extensionVersion: "3.0.0",
            clientVersion: "2.95.0"
        )

        XCTAssertEqual(snapshot.compatibility, .major)
        XCTAssertEqual(snapshot.versionHint, "macOS 客户端版本较旧，建议更新")
    }

    func testProtocolMismatchWinsOverVersionDirection() {
        let snapshot = BridgeStatusSnapshot.make(
            hostConnected: true,
            extensionConnected: true,
            extensionVersion: "2.95.0",
            extensionProtocolVersion: 3,
            clientVersion: "2.95.0",
            clientProtocol: 2
        )

        XCTAssertEqual(snapshot.compatibility, .major)
        XCTAssertEqual(snapshot.versionHint, "客户端与扩展协议版本不一致，建议更新")
    }

    func testBridgeUnavailableSnapshot() {
        let snapshot = BridgeStatusSnapshot.bridgeUnavailable()

        XCTAssertFalse(snapshot.ready)
        XCTAssertEqual(snapshot.text, "本地桥启动失败")
        XCTAssertEqual(snapshot.menuTitle, "浏览器：本地桥启动失败")
        XCTAssertNil(snapshot.versionHint)
    }
}
