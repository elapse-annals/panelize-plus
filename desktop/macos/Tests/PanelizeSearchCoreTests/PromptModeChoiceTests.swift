import AppKit
import XCTest
@testable import PanelizeSearchCore

final class PromptModeChoiceTests: XCTestCase {
    func testCyclingForwardFollowsPickerOrderAndWraps() {
        let all = PromptModeChoice.allCases
        for (index, choice) in all.enumerated() {
            XCTAssertEqual(choice.cycled(), all[(index + 1) % all.count])
        }
    }

    func testCyclingBackwardWrapsFromFirstToLast() {
        XCTAssertEqual(PromptModeChoice.allCases[0].cycled(forward: false), PromptModeChoice.allCases.last)
        XCTAssertEqual(PromptModeChoice.learning.cycled(forward: false), .concise)
    }

    func testSymbolNamesMatchEachMode() {
        XCTAssertEqual(PromptModeChoice.defaultMode.symbolName, "minus.circle")
        XCTAssertEqual(PromptModeChoice.auto.symbolName, "sparkles")
        XCTAssertEqual(PromptModeChoice.concise.symbolName, "list.bullet")
        XCTAssertEqual(PromptModeChoice.learning.symbolName, "graduationcap")
        XCTAssertEqual(PromptModeChoice.compete.symbolName, "exclamationmark.bubble")
        XCTAssertEqual(PromptModeChoice.brainstorm.symbolName, "lightbulb")
        XCTAssertEqual(PromptModeChoice.deep.symbolName, "brain.head.profile")
    }

    func testSymbolNamesAreUnique() {
        let names = PromptModeChoice.allCases.map(\.symbolName)
        XCTAssertEqual(Set(names).count, names.count)
    }

    func testEverySymbolNameResolves() {
        for choice in PromptModeChoice.allCases {
            XCTAssertNotNil(
                NSImage(systemSymbolName: choice.symbolName, accessibilityDescription: nil),
                "Missing SF Symbol for \(choice.rawValue): \(choice.symbolName)"
            )
        }
    }
}
