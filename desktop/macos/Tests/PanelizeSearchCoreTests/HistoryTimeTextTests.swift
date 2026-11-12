import XCTest
@testable import PanelizeSearchCore

final class HistoryTimeTextTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

    func testRecentAgesUseCompactChineseLabels() {
        let now: Double = 1_800_000_000_000
        XCTAssertEqual(historyTimestampText(millis: now - 10_000, nowMillis: now, calendar: calendar), "刚刚")
        XCTAssertEqual(historyTimestampText(millis: now - 5 * 60_000, nowMillis: now, calendar: calendar), "5 分钟前")
        XCTAssertEqual(historyTimestampText(millis: now - 59 * 60_000, nowMillis: now, calendar: calendar), "59 分钟前")
        XCTAssertEqual(historyTimestampText(millis: now - 3 * 3_600_000, nowMillis: now, calendar: calendar), "3 小时前")
        XCTAssertEqual(historyTimestampText(millis: now - 23 * 3_600_000, nowMillis: now, calendar: calendar), "23 小时前")
    }

    func testYesterdayAndOlderUseClockOrDate() {
        let now: Double = 1_800_000_000_000
        let yesterday = historyTimestampText(
            millis: now - 26 * 3_600_000,
            nowMillis: now,
            calendar: calendar
        )
        XCTAssertTrue(yesterday.hasPrefix("昨天 "))
        XCTAssertNotNil(yesterday.range(of: #"昨天 \d{2}:\d{2}"#, options: .regularExpression))

        let older = historyTimestampText(
            millis: now - 5 * 24 * 3_600_000,
            nowMillis: now,
            calendar: calendar
        )
        XCTAssertNotNil(older.range(of: #"\d{2}-\d{2} \d{2}:\d{2}"#, options: .regularExpression))
    }

    func testInvalidTimestampsReturnEmptyText() {
        XCTAssertEqual(historyTimestampText(millis: 0, nowMillis: 1_800_000_000_000, calendar: calendar), "")
        XCTAssertEqual(historyTimestampText(millis: -1, nowMillis: 1_800_000_000_000, calendar: calendar), "")
        XCTAssertEqual(historyTimestampText(millis: .nan, nowMillis: 1_800_000_000_000, calendar: calendar), "")
    }
}