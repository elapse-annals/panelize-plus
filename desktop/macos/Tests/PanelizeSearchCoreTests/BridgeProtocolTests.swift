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

    func testPromptModeDefaultsAndPersistence() throws {
        let suiteName = "PanelizeSearchTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertEqual(PromptModeChoice.load(from: defaults), .auto)
        PromptModeChoice.concise.save(to: defaults)
        XCTAssertEqual(PromptModeChoice.load(from: defaults), .concise)
        defaults.set("unknown", forKey: PromptModeChoice.defaultsKey)
        XCTAssertEqual(PromptModeChoice.load(from: defaults), .auto)
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

    func testShortcutDefaultsAndPersistence() throws {
        let suiteName = "PanelizeSearchTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertEqual(ShortcutChoice.load(from: defaults), .optionSpace)
        ShortcutChoice.commandShiftSpace.save(to: defaults)
        XCTAssertEqual(ShortcutChoice.load(from: defaults), .commandShiftSpace)
    }
}