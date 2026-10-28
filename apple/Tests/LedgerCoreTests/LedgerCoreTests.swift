import XCTest
@testable import LedgerCore

final class LedgerCoreTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try Data(contentsOf: folder.appendingPathComponent("fixtures").appendingPathComponent(name))
    }
    func testLegacyCSVMatchesWebIDsAndTotals() throws {
        let imported = try Transfer.read(fixture("legacy-test.csv"), fallbackCurrency: "AUD")
        let expected = try JSONDecoder().decode([String].self, from: fixture("cross-platform-identities.json"))
        XCTAssertEqual(imported.entries.map(\.id), expected)
        XCTAssertEqual(imported.entries.count, 24)
        XCTAssertEqual(imported.entries.filter { $0.type == "expense" }.reduce(0) { $0 + $1.amountCents }, 158_383)
        XCTAssertEqual(imported.entries.filter { $0.type == "income" }.reduce(0) { $0 + $1.amountCents }, 560_015)
        XCTAssertTrue(imported.entries.contains { $0.note.contains("\n") && $0.note.contains("\"weekend\"") })
        XCTAssertTrue(imported.legacyCSV)
    }
    func testWebCSVAndJSONGenerateSameDueEntriesWithoutDuplicates() throws {
        for name in ["recurring-test-v2.csv", "complete-test-backup.json"] {
            let imported = try Transfer.read(fixture(name), fallbackCurrency: "AUD")
            let generated = try Repeats.materialise(series: imported.series, existing: imported.entries, today: "2026-10-28")
            XCTAssertEqual(Set(generated.entries.map { "\($0.seriesId!):\($0.occurredAt)" }), Set(["demo-daily:2026-10-28", "demo-weekly:2026-10-22", "demo-yearly:2026-02-28"]), name)
            let again = try Repeats.materialise(series: generated.series, existing: imported.entries + generated.entries, today: "2026-10-28")
            XCTAssertTrue(again.entries.isEmpty, name)
            XCTAssertFalse(generated.entries.contains { $0.seriesId == "demo-monthly" || $0.seriesId == "demo-stopped" })
            let expectedBin = name.hasSuffix("json") ? 3 : 0
            XCTAssertEqual(imported.entries.filter { $0.deletedAt != nil }.count, expectedBin)
        }
    }
    func testMonthEndAndLeapDaySchedulesDoNotDrift() throws {
        let monthly = RepeatRule(every: 1, unit: "month"), yearly = RepeatRule(every: 1, unit: "year")
        XCTAssertEqual(try Day.occurrence(anchor: "2026-01-31", rule: monthly, index: 1), "2026-02-28")
        XCTAssertEqual(try Day.occurrence(anchor: "2026-01-31", rule: monthly, index: 2), "2026-03-31")
        XCTAssertEqual(try Day.occurrence(anchor: "2024-02-29", rule: yearly, index: 1), "2025-02-28")
        XCTAssertEqual(try Day.occurrence(anchor: "2024-02-29", rule: yearly, index: 4), "2028-02-29")
    }
    func testBackupAndCSVPreserveRulesCurrencyTagsAndProgress() throws {
        let imported = try Transfer.read(fixture("complete-test-backup.json"), fallbackCurrency: "AUD")
        let backup = Backup(entries: imported.entries, series: imported.series, categories: imported.categories, preferences: imported.preferences!)
        let roundTrip = try Transfer.read(Transfer.backup(backup), fallbackCurrency: "USD")
        XCTAssertEqual(Set(roundTrip.entries.map(\.id)), Set(imported.entries.map(\.id)))
        XCTAssertEqual(roundTrip.entries.filter { $0.deletedAt != nil }.count, 3)
        XCTAssertEqual(roundTrip.preferences?.weekOutlierFilter, true)
        let csv = try Transfer.read(Transfer.csv(entries: imported.entries, series: imported.series), fallbackCurrency: "EUR")
        XCTAssertEqual(csv.entries.count, 10)
        XCTAssertEqual(csv.entries.first { $0.id == "demo-usd" }?.currency, "USD")
        XCTAssertEqual(csv.entries.first { $0.id == "demo-weekly" }?.tags, ["demo"])
        XCTAssertEqual(csv.series.first { $0.id == "demo-weekly" }?.through, "2026-10-15")
        XCTAssertNil(csv.series.first { $0.id == "demo-stopped" }?.rule)
    }
    func testInvalidFinalRowRejectsEntireFile() throws {
        let value = "Date,Category,Note,Account,Amount\n2026-10-01,Dine,Good,Cash,-1\n2026-02-30,Dine,Bad,Cash,-1"
        XCTAssertThrowsError(try Transfer.read(Data(value.utf8), fallbackCurrency: "AUD"))
        for amount in ["1e2", "0", "-0.001", "NaN", "\"-1,23\""] {
            XCTAssertThrowsError(try Transfer.read(Data("Date,Category,Note,Account,Amount\n2026-10-01,Dine,Bad,Cash,\(amount)".utf8), fallbackCurrency: "AUD"))
        }
    }
    func testGeneratedIDsAreDeterministicAcrossIndependentDevices() throws {
        let imported = try Transfer.read(fixture("complete-test-backup.json"), fallbackCurrency: "AUD")
        let one = try Repeats.materialise(series: imported.series, existing: imported.entries, today: "2026-10-28")
        let two = try Repeats.materialise(series: imported.series, existing: imported.entries, today: "2026-10-28")
        XCTAssertEqual(Set(one.entries.map(\.id)), Set(two.entries.map(\.id)))
    }
    func testCatchupLimitIsSharedAcrossSeries() throws {
        let first = Entry(id: "a", occurredAt: "2020-01-01", amountCents: 100, repeat: RepeatRule(every: 1, unit: "day"), seriesId: "a")
        let second = Entry(id: "b", occurredAt: "2020-01-01", amountCents: 100, repeat: RepeatRule(every: 1, unit: "day"), seriesId: "b")
        let rules = Repeats.reconstruct(entries: [first, second], marks: [:])
        let firstBatch = try Repeats.materialise(series: rules, existing: [first, second], today: "2026-10-28")
        XCTAssertEqual(firstBatch.entries.count, 400)
        let next = try Repeats.materialise(series: firstBatch.series, existing: [first, second] + firstBatch.entries, today: "2026-10-28")
        XCTAssertEqual(next.entries.count, 400)
        XCTAssertTrue(Set(firstBatch.entries.map(\.id)).isDisjoint(with: Set(next.entries.map(\.id))))
    }
}
