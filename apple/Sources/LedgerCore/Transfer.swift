import Foundation

public struct Backup: Codable, Sendable {
    public var format = "bros-ledger-backup"
    public var version = 2
    public var exportedAt: String
    public var transactions: [Entry]
    public var deletedTransactions: [Entry]
    public var categories: [Category]
    public var repeatMarks: [String: String]
    public var preferences: Preferences
    public var seriesState: [Series]?
    public init(entries: [Entry], series: [Series], categories: [Category], preferences: Preferences) {
        exportedAt = ISO8601DateFormatter().string(from: Date())
        transactions = entries.filter { $0.deletedAt == nil }; deletedTransactions = entries.filter { $0.deletedAt != nil }
        self.categories = categories; self.preferences = preferences; seriesState = series
        repeatMarks = Dictionary(series.map { ($0.id, $0.through) }, uniquingKeysWith: max)
    }
}
public struct ImportBundle: Sendable {
    public var entries: [Entry]; public var series: [Series]; public var categories: [Category]
    public var preferences: Preferences?; public var legacyCSV: Bool
    public init(entries: [Entry], series: [Series], categories: [Category] = [], preferences: Preferences? = nil, legacyCSV: Bool = false) {
        self.entries = entries; self.series = series; self.categories = categories; self.preferences = preferences; self.legacyCSV = legacyCSV
    }
    public var summary: String {
        "\(entries.filter { $0.deletedAt == nil }.count) transactions, \(entries.filter { $0.deletedAt != nil }.count) Bin records, \(series.filter { $0.rule != nil }.count) active schedules. " + (legacyCSV ? "This older CSV has no repeat rules. Add schedules manually, or export an App Backup from the updated website." : "Schedules and generation progress will be preserved.")
    }
}
public enum Transfer {
    public static let columns = ["Date", "Category", "Note", "Account", "Amount", "Currency", "ID", "Series ID", "Repeat Every", "Repeat Unit", "Series Anchor", "Generated Through", "Source", "Tags"]
    public static func read(_ data: Data, fallbackCurrency: String) throws -> ImportBundle {
        guard data.count <= 50_000_000, let text = String(data: data, encoding: .utf8) else { throw LedgerError("Choose a UTF-8 CSV or JSON backup smaller than 50 MB.") }
        let clean = text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
        if clean.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("{") {
            let b = try JSONDecoder().decode(Backup.self, from: Data(clean.utf8))
            guard b.format == "bros-ledger-backup", b.version == 2 else { throw LedgerError("Unsupported backup format or version.") }
            let all = b.transactions + b.deletedTransactions
            try validate(all)
            guard b.transactions.allSatisfy({ $0.deletedAt == nil }), b.deletedTransactions.allSatisfy({ $0.deletedAt != nil }),
                  b.repeatMarks.allSatisfy({ validLedgerID($0.key) && Day.valid($0.value) }), b.preferences.currency.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil,
                  ["system", "light", "dark"].contains(b.preferences.theme), ["mono", "forest", "ocean", "indigo", "plum", "terracotta"].contains(b.preferences.palette),
                  b.categories.allSatisfy({ validLedgerID($0.id) && !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && ["expense", "income"].contains($0.type) }),
                  Set(b.categories.map(\.id)).count == b.categories.count else { throw LedgerError("Invalid backup metadata.") }
            let schedules = b.seriesState ?? Repeats.reconstruct(entries: all, marks: b.repeatMarks)
            guard Set(schedules.map(\.id)).count == schedules.count else { throw LedgerError("Duplicate schedule IDs.") }
            for s in schedules {
                try s.template.validate()
                guard validLedgerID(s.id), Day.valid(s.anchor), Day.valid(s.through),
                      s.rule == nil || s.rule!.isValid else { throw LedgerError("Invalid backup schedule.") }
            }
            return ImportBundle(entries: all, series: schedules, categories: b.categories, preferences: b.preferences)
        }
        return try readCSV(text, currency: fallbackCurrency)
    }
    public static func backup(_ backup: Backup) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(backup)
    }
    private static func validate(_ entries: [Entry]) throws {
        guard entries.count <= 100_000, Set(entries.map(\.id)).count == entries.count else { throw LedgerError("Duplicate transaction IDs in this file.") }
        for entry in entries { try entry.validate() }
    }
    public static func parseCSV(_ text: String) throws -> [[String]] {
        let chars = Array(text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text)
        var rows: [[String]] = []; var row: [String] = []; var field = ""; var quoted = false; var closed = false; var i = 0
        while i < chars.count {
            let c = chars[i]
            if quoted {
                if c == "\"", i + 1 < chars.count, chars[i + 1] == "\"" { field.append("\""); i += 1 }
                else if c == "\"" { quoted = false; closed = true }
                else { field.append(c) }
            } else if c == "\"" {
                guard field.isEmpty, !closed else { throw LedgerError("Invalid CSV quoting.") }; quoted = true
            } else if c == "," { row.append(field); field = ""; closed = false }
            else if c == "\n" || c == "\r" || c == "\r\n" {
                if c == "\r", i + 1 < chars.count, chars[i + 1] == "\n" { i += 1 }
                row.append(field); if row.contains(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) { rows.append(row) }
                row = []; field = ""; closed = false
            } else { guard !closed else { throw LedgerError("Invalid CSV quoting.") }; field.append(c) }
            i += 1
        }
        guard !quoted else { throw LedgerError("The CSV has an unclosed quote.") }
        if !field.isEmpty || !row.isEmpty || closed { row.append(field); if row.contains(where: { !$0.isEmpty }) { rows.append(row) } }
        return rows
    }
    private static func fingerprint(_ entry: Entry) throws -> String {
        let values: [Any] = [entry.occurredAt, entry.type, entry.amountCents, entry.currency, entry.category, entry.account, entry.note]
        let data = try JSONSerialization.data(withJSONObject: values, options: [.fragmentsAllowed, .withoutEscapingSlashes])
        return String(decoding: data, as: UTF8.self)
    }
    private static func legacyID(_ key: String, occurrence: Int) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in key.utf8 { hash = (hash ^ UInt64(byte)) &* 1_099_511_628_211 }
        return "csv:" + String(format: "%016llx", hash) + ":\(occurrence)"
    }
    public static func readCSV(_ text: String, currency: String) throws -> ImportBundle {
        let rows = try parseCSV(text)
        guard rows.count > 1, rows.count <= 100_001 else { throw LedgerError("The CSV has no entries or is too large.") }
        let headers = rows[0].map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        guard Set(headers).count == headers.count else { throw LedgerError("Duplicate CSV columns.") }
        for name in columns.prefix(5) where !headers.contains(name.lowercased()) { throw LedgerError("Missing CSV column: \(name)") }
        let version2 = columns[6...11].contains { headers.contains($0.lowercased()) }
        if version2, columns[5...11].contains(where: { !headers.contains($0.lowercased()) }) { throw LedgerError("Incomplete repeat metadata.") }
        var entries: [Entry] = []; var occurrences: [String: Int] = [:]
        for (position, row) in rows.dropFirst().enumerated() {
            func value(_ name: String) -> String { guard let index = headers.firstIndex(of: name), index < row.count else { return "" }; return row[index] }
            func trimmed(_ name: String) -> String { value(name).trimmingCharacters(in: .whitespacesAndNewlines) }
            func invalid() -> LedgerError { LedgerError("CSV row \(position + 2) has invalid data.") }
            guard row.count == headers.count else { throw invalid() }
            let numeric = trimmed("amount").replacingOccurrences(of: "−", with: "-")
                .replacingOccurrences(of: "^([+-]?)(?:[A-Z]{3}\\s*|[$€£¥])", with: "$1", options: .regularExpression)
            guard numeric.range(of: "^[+-]?(?:\\d+|\\d{1,3}(?:,\\d{3})+)(?:\\.\\d{1,2})?$", options: .regularExpression) != nil,
                  let decimal = Decimal(string: numeric.replacingOccurrences(of: ",", with: ""), locale: Locale(identifier: "en_US_POSIX")) else { throw invalid() }
            let centsNumber = NSDecimalNumber(decimal: decimal * 100)
            let max = NSDecimalNumber(string: "9007199254740991"), min = NSDecimalNumber(string: "-9007199254740991")
            guard centsNumber != .zero, centsNumber.compare(max) != .orderedDescending, centsNumber.compare(min) != .orderedAscending else { throw invalid() }
            let cents = centsNumber.int64Value
            let every = trimmed("repeat every"), unit = trimmed("repeat unit")
            var rule: RepeatRule?
            if !every.isEmpty || !unit.isEmpty {
                guard every.range(of: "^\\d+$", options: .regularExpression) != nil, let interval = Int(every) else { throw invalid() }
                rule = RepeatRule(every: interval, unit: unit)
                guard rule!.isValid else { throw invalid() }
            }
            var e = Entry(id: "pending", occurredAt: trimmed("date"), type: cents > 0 ? "income" : "expense", amountCents: Int(abs(cents)),
                          currency: trimmed("currency").isEmpty ? currency : trimmed("currency"),
                          category: trimmed("category").isEmpty ? (cents > 0 ? "Income" : "Other") : trimmed("category"),
                          account: trimmed("account").isEmpty ? "Everyday" : trimmed("account"), note: value("note"), repeat: rule)
            if version2 {
                e.id = trimmed("id"); e.seriesId = trimmed("series id"); e.seriesAnchor = trimmed("series anchor")
                e.generatedThrough = trimmed("generated through")
                guard !e.id.isEmpty, !(e.seriesId ?? "").isEmpty, Day.valid(e.seriesAnchor ?? ""),
                      Day.valid(e.generatedThrough ?? ""), e.generatedThrough! >= e.occurredAt else { throw invalid() }
                let tags = value("tags")
                if !tags.isEmpty {
                    guard let data = tags.data(using: .utf8), let decoded = try? JSONDecoder().decode([String].self, from: data) else { throw invalid() }
                    e.tags = decoded
                }
            } else {
                let key = try fingerprint(e); occurrences[key, default: 0] += 1
                e.id = legacyID(key, occurrence: occurrences[key]!)
            }
            e.source = trimmed("source").isEmpty ? "csv" : trimmed("source")
            do { try e.validate() } catch { throw invalid() }
            entries.append(e)
        }
        try validate(entries)
        return ImportBundle(entries: entries, series: Repeats.reconstruct(entries: entries, marks: [:]), legacyCSV: !version2)
    }
    public static func csv(entries: [Entry], series: [Series]) -> Data {
        let schedules = Dictionary(series.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let rows = entries.filter { $0.deletedAt == nil }.map { e -> [String] in
            let s = schedules[e.seriesId ?? e.id]
            // The latest template carries edits/stops made after the last occurrence.
            let rule = s?.rule
            return [e.occurredAt, e.category, e.note, e.account, (e.type == "income" ? "" : "-") + String(e.amountCents / 100) + "." + String(format: "%02d", e.amountCents % 100), e.currency, e.id,
                    e.seriesId ?? e.id, rule.map { String($0.every) } ?? "", rule?.unit ?? "", s?.anchor ?? e.seriesAnchor ?? e.occurredAt, max(s?.through ?? e.occurredAt, e.occurredAt), e.source, String(decoding: (try? JSONEncoder().encode(e.tags)) ?? Data("[]".utf8), as: UTF8.self)]
        }
        return Data(("\u{FEFF}" + ([columns] + rows).map { $0.map { "\"" + $0.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }.joined(separator: ",") }.joined(separator: "\r\n")).utf8)
    }
}
