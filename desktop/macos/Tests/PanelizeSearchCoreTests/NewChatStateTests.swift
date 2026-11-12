import XCTest
@testable import PanelizeSearchCore

final class NewChatStateTests: XCTestCase {
    func testPreferencePersistsAcrossInstances() throws {
        let suiteName = "NewChatStateTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let preference = NewChatPreference(defaults: defaults, key: "newChat")
        XCTAssertFalse(preference.load())
        preference.save(true)
        XCTAssertTrue(NewChatPreference(defaults: defaults, key: "newChat").load())
    }

    func testPrepareOnlyRunsWhenEnabledAndNothingIsPending() {
        var state = NewChatState(enabled: false)
        XCTAssertFalse(state.prepareIfNeeded(requestId: "r1"))

        state.setEnabled(true)
        XCTAssertTrue(state.prepareIfNeeded(requestId: "r1"))
        XCTAssertTrue(state.isRequesting)
        XCTAssertEqual(state.requestId, "r1")
        XCTAssertFalse(state.prepareIfNeeded(requestId: "r2"))
    }

    func testPreparedStateSkipsAnotherRequestUntilASend() {
        var state = NewChatState(enabled: true)
        XCTAssertTrue(state.prepareIfNeeded(requestId: "r1"))
        XCTAssertTrue(state.completeRequest("r1", ok: true, ready: 3, total: 3))
        XCTAssertTrue(state.isPrepared)
        XCTAssertFalse(state.shouldPrepareOnShow)
        XCTAssertFalse(state.prepareIfNeeded(requestId: "r2"))

        state.sendSucceeded()
        XCTAssertFalse(state.isPrepared)
        XCTAssertTrue(state.shouldPrepareOnShow)
    }

    func testPartialOrFailedResultsDoNotMarkTheStatePrepared() {
        var state = NewChatState(enabled: true)
        XCTAssertTrue(state.prepareIfNeeded(requestId: "r1"))
        XCTAssertTrue(state.completeRequest("r1", ok: false, ready: 1, total: 3))
        XCTAssertFalse(state.isPrepared)
        if case .failed = state.phase {} else { XCTFail("expected failed phase") }

        XCTAssertTrue(state.prepareIfNeeded(requestId: "r2"))
        XCTAssertTrue(state.failRequest("r2", reason: "no-response"))
        XCTAssertFalse(state.isPrepared)
    }

    func testStaleRequestResultsAreIgnored() {
        var state = NewChatState(enabled: true)
        XCTAssertTrue(state.prepareIfNeeded(requestId: "current"))
        XCTAssertFalse(state.completeRequest("older", ok: true, ready: 1, total: 1))
        XCTAssertFalse(state.failRequest("older"))
        XCTAssertTrue(state.isRequesting)
        XCTAssertTrue(state.completeRequest("current", ok: true, ready: 1, total: 1))
    }

    func testDisablingResetsAndConnectionLossFailsAnInFlightRequest() {
        var state = NewChatState(enabled: true)
        XCTAssertTrue(state.prepareIfNeeded(requestId: "r1"))
        state.connectionLost()
        XCTAssertFalse(state.isRequesting)
        if case .failed = state.phase {} else { XCTFail("expected failed phase") }

        state.setEnabled(false)
        XCTAssertFalse(state.enabled)
        XCTAssertEqual(state.phase, .idle)
    }
}