// Foundation-only checks run with Apple's command-line tools when Xcode is absent.
import Foundation

struct CheckFailure: Error { let message: String }
func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw CheckFailure(message: message) }
    print("PASS \(message)")
}
@main struct CheckRunner {
    static func main() throws {
        let folder = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("fixtures")
        func data(_ name: String) throws -> Data { try Data(contentsOf: folder.appendingPathComponent(name)) }
        let old = try Transfer.read(data("legacy-test.csv"), fallbackCurrency: "AUD")
        let webIDs = try JSONDecoder().decode([String].self, from: data("cross-platform-identities.json"))
        try require(old.entries.count == 24 && old.entries.map(\.id) == webIDs, "Legacy CSV IDs match the website exactly")
        try require(old.entries.filter { $0.type == "expense" }.reduce(0) { $0 + $1.amountCents } == 158_383, "Legacy expense amounts are exact")
        try require(old.entries.filter { $0.type == "income" }.reduce(0) { $0 + $1.amountCents } == 560_015, "Legacy income amounts are exact")
        let expected = Set(["demo-daily:2026-10-28", "demo-weekly:2026-10-22", "demo-yearly:2026-02-28"])
        for file in ["recurring-test-v2.csv", "complete-test-backup.json"] {
            let imported = try Transfer.read(data(file), fallbackCurrency: "AUD")
            let generated = try Repeats.materialise(series: imported.series, existing: imported.entries, today: "2026-10-28")
            let due = Set(generated.entries.map { "\($0.seriesId!):\($0.occurredAt)" })
            try require(due == expected, "\(file): three expected due entries and no deleted occurrences")
            let again = try Repeats.materialise(series: generated.series, existing: imported.entries + generated.entries, today: "2026-10-28")
            try require(again.entries.isEmpty, "\(file): second load is idempotent")
            let other = try Repeats.materialise(series: imported.series, existing: imported.entries, today: "2026-10-28")
            try require(Set(other.entries.map(\.id)) == Set(generated.entries.map(\.id)), "\(file): generated IDs match across devices")
        }
        let monthly = RepeatRule(every: 1, unit: "month"), yearly = RepeatRule(every: 1, unit: "year")
        let feb = try Day.occurrence(anchor: "2026-01-31", rule: monthly, index: 1)
        let mar = try Day.occurrence(anchor: "2026-01-31", rule: monthly, index: 2)
        let leap = try Day.occurrence(anchor: "2024-02-29", rule: yearly, index: 4)
        try require(feb == "2026-02-28" && mar == "2026-03-31" && leap == "2028-02-29", "Month end and leap-day schedules do not drift")
        let full = try Transfer.read(data("complete-test-backup.json"), fallbackCurrency: "AUD")
        let backup = Backup(entries: full.entries, series: full.series, categories: full.categories, preferences: full.preferences!)
        let nativeBackup = try Transfer.backup(backup)
        let nativeCSV = Transfer.csv(entries: full.entries, series: full.series)
        try nativeBackup.write(to: URL(fileURLWithPath: "/private/tmp/simple-ledger-native-checks/native-backup.json"))
        try nativeCSV.write(to: URL(fileURLWithPath: "/private/tmp/simple-ledger-native-checks/native-export.csv"))
        let restored = try Transfer.read(nativeBackup, fallbackCurrency: "USD")
        try require(restored.entries.count == 13 && restored.entries.filter { $0.deletedAt != nil }.count == 3, "Complete backup retains entries and Bin")
        try require(restored.preferences?.weekOutlierFilter == true, "Website chart preference survives native backup")
        let csv = try Transfer.read(Transfer.csv(entries: full.entries, series: full.series), fallbackCurrency: "EUR")
        try require(csv.entries.count == 10 && csv.entries.first { $0.id == "demo-usd" }?.currency == "USD", "Native CSV retains currencies")
        try require(csv.entries.first { $0.id == "demo-weekly" }?.tags == ["demo"] && csv.series.first { $0.id == "demo-weekly" }?.through == "2026-10-15", "Native CSV retains tags and repeat progress")
        let bad = "Date,Category,Note,Account,Amount\n2026-10-01,Dine,Good,Cash,-1\n2026-02-30,Dine,Bad,Cash,-1"
        var invalidRejected = false
        do { _ = try Transfer.read(Data(bad.utf8), fallbackCurrency: "AUD") } catch { invalidRejected = true }
        try require(invalidRejected, "An invalid last row rejects the entire CSV")
        let first = Entry(id: "a", occurredAt: "2020-01-01", amountCents: 100, repeat: RepeatRule(every: 1, unit: "day"), seriesId: "a")
        let second = Entry(id: "b", occurredAt: "2020-01-01", amountCents: 100, repeat: RepeatRule(every: 1, unit: "day"), seriesId: "b")
        let series = Repeats.reconstruct(entries: [first, second], marks: [:])
        let batch = try Repeats.materialise(series: series, existing: [first, second], today: "2026-10-28")
        let next = try Repeats.materialise(series: batch.series, existing: [first, second] + batch.entries, today: "2026-10-28")
        try require(batch.entries.count == 400 && next.entries.count == 400 && Set(batch.entries.map(\.id)).isDisjoint(with: Set(next.entries.map(\.id))), "400-entry cap resumes without duplicates")
    }
}
