import XCTest
@testable import PanelizeSearchCore

final class VersionUtilsTests: XCTestCase {
    func testCompareVersionsOrdersNumericComponents() {
        XCTAssertEqual(VersionUtils.compareVersions("2.94.2", "2.95.0"), .orderedAscending)
        XCTAssertEqual(VersionUtils.compareVersions("2.95.0", "2.95.0"), .orderedSame)
        XCTAssertEqual(VersionUtils.compareVersions("3.0.0", "2.99.99"), .orderedDescending)
        XCTAssertEqual(VersionUtils.compareVersions("v2.94.2", "2.94.10"), .orderedAscending)
        XCTAssertEqual(VersionUtils.compareVersions(" 2.95.0 ", "2.95.0"), .orderedSame)
    }

    func testCompareVersionsTreatsMalformedInputAsEqual() {
        XCTAssertEqual(VersionUtils.compareVersions("latest", "2.95.0"), .orderedSame)
        XCTAssertEqual(VersionUtils.compareVersions("2.95", "2.95.0"), .orderedSame)
        XCTAssertEqual(VersionUtils.compareVersions("", "2.95.0"), .orderedSame)
        XCTAssertEqual(VersionUtils.compareVersions("2.95.0.1", "2.95.0"), .orderedSame)
    }

    func testNormalizedVersionStripsPrefixAndRejectsInvalidValues() {
        XCTAssertEqual(VersionUtils.normalizedVersion("v2.95.0"), "2.95.0")
        XCTAssertEqual(VersionUtils.normalizedVersion(" 2.095.0 "), "2.95.0")
        XCTAssertNil(VersionUtils.normalizedVersion("2.95"))
        XCTAssertNil(VersionUtils.normalizedVersion("2.95.0-beta"))
        XCTAssertNil(VersionUtils.normalizedVersion(""))
    }

    func testCompatibilityTreatsPatchDifferencesAsCompatible() {
        XCTAssertEqual(
            VersionUtils.compatibilityLevel(clientVersion: "2.95.0", extensionVersion: "2.95.1"),
            .compatible
        )
    }

    func testCompatibilityDetectsMinorAndMajorDifferences() {
        XCTAssertEqual(
            VersionUtils.compatibilityLevel(clientVersion: "2.95.0", extensionVersion: "2.94.1"),
            .minor
        )
        XCTAssertEqual(
            VersionUtils.compatibilityLevel(clientVersion: "2.95.0", extensionVersion: "3.0.0"),
            .major
        )
        XCTAssertEqual(
            VersionUtils.compatibilityLevel(
                clientVersion: "2.95.0",
                extensionVersion: "2.95.0",
                clientProtocol: 2,
                extensionProtocol: 3
            ),
            .major
        )
    }

    func testCompatibilityIsUnknownWithoutBothVersions() {
        XCTAssertEqual(
            VersionUtils.compatibilityLevel(clientVersion: "2.95.0", extensionVersion: ""),
            .unknown
        )
        XCTAssertEqual(
            VersionUtils.compatibilityLevel(clientVersion: "latest", extensionVersion: "2.95.0"),
            .unknown
        )
    }

    func testVersionHintsPointAtTheOlderSide() {
        XCTAssertEqual(
            VersionUtils.versionHint(
                level: .minor,
                clientVersion: "2.95.0",
                extensionVersion: "2.94.1"
            ),
            "扩展版本较旧，建议更新"
        )
        XCTAssertEqual(
            VersionUtils.versionHint(
                level: .minor,
                clientVersion: "2.94.1",
                extensionVersion: "2.95.0"
            ),
            "macOS 客户端版本较旧，建议更新"
        )
        XCTAssertEqual(
            VersionUtils.versionHint(
                level: .major,
                clientVersion: "3.0.0",
                extensionVersion: "2.95.0"
            ),
            "扩展版本过旧，建议更新"
        )
        XCTAssertEqual(
            VersionUtils.versionHint(
                level: .major,
                clientVersion: "2.95.0",
                extensionVersion: "3.0.0"
            ),
            "macOS 客户端版本较旧，建议更新"
        )
        XCTAssertNil(
            VersionUtils.versionHint(
                level: .compatible,
                clientVersion: "2.95.0",
                extensionVersion: "2.95.1"
            )
        )
        XCTAssertNil(
            VersionUtils.versionHint(
                level: .unknown,
                clientVersion: "2.95.0",
                extensionVersion: ""
            )
        )
    }

    func testVersionHintReportsProtocolMismatch() {
        XCTAssertEqual(
            VersionUtils.versionHint(
                level: .major,
                clientVersion: "2.95.0",
                extensionVersion: "2.95.0",
                clientProtocol: 2,
                extensionProtocol: 3
            ),
            "客户端与扩展协议版本不一致，建议更新"
        )
    }

    func testCurrentAppVersionReadsTheBundleShortVersion() {
        let version = VersionUtils.currentAppVersion(
            infoDictionary: ["CFBundleShortVersionString": " 2.95.0 "],
            fallback: "0.0.0"
        )
        XCTAssertEqual(version, "2.95.0")
    }

    func testCurrentAppVersionFallsBackWhenTheBundleHasNoVersion() {
        XCTAssertEqual(
            VersionUtils.currentAppVersion(infoDictionary: nil, fallback: "9.9.9"),
            "9.9.9"
        )
        XCTAssertEqual(
            VersionUtils.currentAppVersion(
                infoDictionary: ["CFBundleShortVersionString": "   "],
                fallback: "9.9.9"
            ),
            "9.9.9"
        )
    }
}
