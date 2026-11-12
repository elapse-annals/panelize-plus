import Foundation

/// A compact timestamp for the history browser's left column.
public func historyTimestampText(
    millis: Double,
    nowMillis: Double,
    calendar: Calendar = .current
) -> String {
    guard millis.isFinite, millis > 0, nowMillis.isFinite else { return "" }
    let age = max(0, nowMillis - millis)
    if age < 60_000 {
        return "刚刚"
    }

    let minutes = Int(age / 60_000)
    if minutes < 60 {
        return "\(minutes) 分钟前"
    }

    let hours = Int(age / 3_600_000)
    if hours < 24 {
        return "\(hours) 小时前"
    }

    let date = Date(timeIntervalSince1970: millis / 1000)
    let now = Date(timeIntervalSince1970: nowMillis / 1000)
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "HH:mm"

    if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
       calendar.isDate(date, inSameDayAs: yesterday) {
        return "昨天 \(formatter.string(from: date))"
    }

    formatter.dateFormat = "MM-dd HH:mm"
    return formatter.string(from: date)
}