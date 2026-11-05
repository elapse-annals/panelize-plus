import XCTest
@testable import PanelizeSearchCore

final class BridgeProtocolTests: XCTestCase {
    func testFrameRoundTripAndPartialReads() throws {
        var reader = NativeFrameReader()
        let frame = try NativeMessagingCodec.encode([
            "protocol": 1,
            "type": "sendPrompt",
            "requestId": "request-1",
            "text": "Hello"
        ])

        reader.append(frame.prefix(3))
        XCTAssertNil(try reader.nextMessage())

        reader.append(frame.dropFirst(3))
        let message = try XCTUnwrap(reader.nextMessage())
        XCTAssertEqual(message["type"] as? String, "sendPrompt")
        XCTAssertEqual(message["text"] as? String, "Hello")
        XCTAssertNil(try reader.nextMessage())
    }

    func testRejectsZeroAndOversizedFrames() throws {
        var zero = NativeFrameReader()
        zero.append(Data([0, 0, 0, 0]))
        XCTAssertThrowsError(try zero.nextMessage()) { error in
            XCTAssertEqual(error as? NativeFrameError, .invalidLength)
        }

        var oversized = NativeFrameReader()
        var length = UInt32(BridgeProtocol.maxFrameBytes + 1).littleEndian
        var header = Data(bytes: &length, count: 4)
        header.append(Data(repeating: 0, count: 8))
        oversized.append(header)
        XCTAssertThrowsError(try oversized.nextMessage()) { error in
            XCTAssertEqual(error as? NativeFrameError, .messageTooLarge)
        }
    }

    func testRejectsInvalidJSON() {
        var reader = NativeFrameReader()
        let payload = Data("not json".utf8)
        var length = UInt32(payload.count).littleEndian
        var frame = Data(bytes: &length, count: 4)
        frame.append(payload)
        reader.append(frame)
        XCTAssertThrowsError(try reader.nextMessage()) { error in
            XCTAssertEqual(error as? NativeFrameError, .invalidJSON)
        }
    }

    func testPromptNormalizationMatchesExtensionLimits() {
        switch PromptInput.normalized("  first\r\nsecond  ") {
        case .success(let text):
            XCTAssertEqual(text, "first\nsecond")
        default:
            XCTFail("Expected a valid prompt")
        }

        XCTAssertEqual(PromptInput.normalized(" \n ") , .failure(.empty))
        XCTAssertEqual(
            PromptInput.normalized(String(repeating: "😀", count: BridgeProtocol.maxPromptCharacters + 1)),
            .failure(.tooLong)
        )
        XCTAssertEqual(PromptInput.isValidRequestId("abc-123"), true)
        XCTAssertEqual(PromptInput.isValidRequestId(" abc "), false)
    }

    func testBridgeEventsOnlyExposeExpectedFields() {
        guard case .sendResult(let outcome)? = BridgeMessages.parse([
            "type": "sendResult",
            "requestId": "r1",
            "ok": true,
            "sent": 4,
            "total": 5,
            "reason": "",
            "answers": ["secret": true]
        ]) else {
            return XCTFail("Expected a send result")
        }
        XCTAssertEqual(outcome, SendOutcome(requestId: "r1", ok: true, sent: 4, total: 5))
        XCTAssertNil(BridgeMessages.parse(["type": "unknown"]))
    }

    func testSendProgressOnlyExposesExpectedFields() {
        guard case .sendProgress(let progress)? = BridgeMessages.parse([
            "type": "sendProgress",
            "requestId": "r1",
            "stage": "preparing",
            "ready": 3,
            "total": 5,
            "pendingCount": 1,
            "timedOutCount": 1,
            "pendingNames": ["Claude", "Gemini"],
            "timedOutNames": ["DeepSeek"],
            "answers": ["secret": true]
        ]) else {
            return XCTFail("Expected send progress")
        }
        XCTAssertEqual(progress, SendProgress(
            requestId: "r1",
            stage: .preparing,
            ready: 3,
            total: 5,
            pendingCount: 1,
            timedOutCount: 1,
            pendingNames: ["Claude", "Gemini"],
            timedOutNames: ["DeepSeek"]
        ))
        XCTAssertNil(BridgeMessages.parse([
            "type": "sendProgress",
            "requestId": "r1",
            "stage": "finished"
        ]))
    }

    func testSendProgressBoundsCountsAndNamesAndHidesBlindNames() {
        guard case .sendProgress(let bounded)? = BridgeMessages.parse([
            "type": "sendProgress",
            "requestId": "r1",
            "stage": "preparing",
            "ready": 9,
            "total": 5,
            "pendingCount": 4,
            "timedOutCount": 4,
            "pendingNames": (0..<30).map { "  AI \($0)  " },
            "timedOutNames": ["Timeout"]
        ]) else {
            return XCTFail("Expected send progress")
        }
        XCTAssertEqual(bounded.ready, 5)
        XCTAssertEqual(bounded.pendingCount, 0)
        XCTAssertEqual(bounded.timedOutCount, 0)
        XCTAssertEqual(bounded.pendingNames.count, BridgeProtocol.maxProgressNames)
        XCTAssertEqual(bounded.pendingNames.first, "AI 0")

        guard case .sendProgress(let blind)? = BridgeMessages.parse([
            "type": "sendProgress",
            "requestId": "r1",
            "stage": "preparing",
            "ready": 3,
            "total": 5,
            "pendingCount": 2,
            "pendingNames": ["Claude", "Gemini"],
            "blind": true
        ]) else {
            return XCTFail("Expected send progress")
        }
        XCTAssertTrue(blind.blind)
        XCTAssertEqual(blind.pendingCount, 2)
        XCTAssertTrue(blind.pendingNames.isEmpty)
    }

    func testSupportDirectoryHonorsTheIsolationOverride() throws {
        let key = BridgeProtocol.supportDirectoryOverrideKey
        let previous = getenv(key).map { String(cString: $0) }
        defer {
            if let previous {
                setenv(key, previous, 1)
            } else {
                unsetenv(key)
            }
        }

        setenv(key, "/tmp/panelize-bridge-override", 1)
        XCTAssertEqual(try BridgeProtocol.supportDirectory().path, "/tmp/panelize-bridge-override")
    }

    func testPromptModeDefaultsAndPersistence() throws {
        XCTAssertEqual(PromptModeChoice.fallback, .auto)
        let suiteName = "PanelizeSearchTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertEqual(PromptModeChoice.load(from: defaults), .auto)
        PromptModeChoice.concise.save(to: defaults)
        XCTAssertEqual(PromptModeChoice.load(from: defaults), .concise)
        defaults.set("unknown", forKey: PromptModeChoice.defaultsKey)
        XCTAssertEqual(PromptModeChoice.load(from: defaults), .auto)
    }

    func testAutoDefaultMigrationResetsAnExistingChoiceOnce() throws {
        let suiteName = "PanelizeSearchTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        PromptModeChoice.compete.save(to: defaults)
        PromptModeChoice.applyAutoDefaultMigrationIfNeeded(from: defaults)
        XCTAssertEqual(PromptModeChoice.load(from: defaults), .auto)

        PromptModeChoice.deep.save(to: defaults)
        PromptModeChoice.applyAutoDefaultMigrationIfNeeded(from: defaults)
        XCTAssertEqual(PromptModeChoice.load(from: defaults), .deep)
    }

    func testPromptModeWireValuesAndMessage() {
        XCTAssertEqual(
            PromptModeChoice.allCases.map(\.rawValue),
            ["default", "auto", "concise", "learning", "compete", "brainstorm", "deep"]
        )
        XCTAssertEqual(PromptModeChoice.wireValue(from: ["promptMode": "deep"]), .deep)
        XCTAssertNil(PromptModeChoice.wireValue(from: [:]))
        XCTAssertNil(PromptModeChoice.wireValue(from: ["promptMode": "custom-x"]))
        XCTAssertNil(PromptModeChoice.wireValue(from: ["promptMode": 3]))

        let withoutMode = BridgeMessages.sendPrompt(requestId: "r1", text: "Hello")
        XCTAssertNil(withoutMode["promptMode"])
        let withMode = BridgeMessages.sendPrompt(requestId: "r1", text: "Hello", promptMode: .auto)
        XCTAssertEqual(withMode["promptMode"] as? String, "auto")
    }

    func testTokenHandshakeCarriesTheBrowserBundleIdentifier() {
        let withBrowser = BridgeMessages.tokenHandshake(
            "token",
            browserBundleIdentifier: "com.google.Chrome"
        )
        XCTAssertEqual(withBrowser["type"] as? String, "bridgeHello")
        XCTAssertEqual(withBrowser["browserBundleId"] as? String, "com.google.Chrome")

        let withoutBrowser = BridgeMessages.tokenHandshake("token")
        XCTAssertNil(withoutBrowser["browserBundleId"])

        let emptyBrowser = BridgeMessages.tokenHandshake("token", browserBundleIdentifier: "")
        XCTAssertNil(emptyBrowser["browserBundleId"])
    }

    func testShortcutDefaultsAndPersistence() throws {
        let suiteName = "PanelizeSearchTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertEqual(ShortcutChoice.load(from: defaults), .optionSpace)
        ShortcutChoice.controlSpace.save(to: defaults)
        XCTAssertEqual(ShortcutChoice.load(from: defaults), .controlSpace)
        ShortcutChoice.commandShiftSpace.save(to: defaults)
        XCTAssertEqual(ShortcutChoice.load(from: defaults), .commandShiftSpace)
    }
}