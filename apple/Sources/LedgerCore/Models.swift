import Foundation

public func validLedgerID(_ value: String) -> Bool {
    !["constructor", "prototype", "__proto__"].contains(value) && value.range(of: "^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$", options: .regularExpression) != nil
}
public struct LedgerError: LocalizedError {
    public var message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}
public struct RepeatRule: Codable, Equatable, Sendable {
    public var every: Int
    public var unit: String
    public init(every: Int, unit: String) { self.every = every; self.unit = unit }
    public var isValid: Bool { (1...365).contains(every) && ["day", "week", "month", "year"].contains(unit) }
}
public struct Entry: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var occurredAt: String
    public var type: String
    public var amountCents: Int
    public var currency: String
    public var category: String
    public var account: String
    public var note: String
    public var tags: [String]
    public var source: String
    public var `repeat`: RepeatRule?
    public var seriesId: String?
    public var seriesAnchor: String?
    public var generatedThrough: String?
    public var deletedAt: String?
    public var purged: Bool?
    public init(id: String = UUID().uuidString, occurredAt: String, type: String = "expense", amountCents: Int,
                currency: String = "AUD", category: String = "Other", account: String = "Everyday", note: String = "",
                repeat rule: RepeatRule? = nil, seriesId: String? = nil) {
        self.id = id; self.occurredAt = occurredAt; self.type = type; self.amountCents = amountCents
        self.currency = currency; self.category = category; self.account = account; self.note = note
        self.tags = []; self.source = "manual"; self.repeat = rule; self.seriesId = seriesId
    }
    public func validate() throws {
        guard validLedgerID(id), Day.valid(occurredAt), ["expense", "income"].contains(type), amountCents > 0,
              amountCents <= 9_007_199_254_740_991, currency.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil,
              !category.isEmpty, !account.isEmpty else { throw LedgerError("Invalid transaction: \(id)") }
        if let seriesId, !validLedgerID(seriesId) { throw LedgerError("Invalid series ID.") }
        if let rule = self.repeat, !rule.isValid { throw LedgerError("Invalid repeat rule: \(id)") }
        if let anchor = seriesAnchor, !Day.valid(anchor) { throw LedgerError("Invalid series anchor.") }
        if let through = generatedThrough, !Day.valid(through) || through < occurredAt { throw LedgerError("Invalid generation cursor.") }
        if let date = deletedAt, ISO8601DateFormatter().date(from: date) == nil && ISO8601DateFormatter.fractional.date(from: date) == nil { throw LedgerError("Invalid Bin timestamp.") }
    }
}
public struct Category: Codable, Identifiable, Equatable, Sendable {
    public var id: String; public var name: String; public var emoji: String; public var type: String
    public init(id: String = UUID().uuidString, name: String, emoji: String = "✨", type: String = "expense") {
        self.id = id; self.name = name; self.emoji = emoji; self.type = type
    }
    public static let defaults = ["Shopping", "Health", "Subscription", "Electronics", "Dine", "Education", "Transport", "Fun", "Other"].map { Category(id: "default:\($0)", name: $0) } + [Category(id: "default:Income", name: "Income", emoji: "💵", type: "income")]
}
public indirect enum JSONValue: Codable, Equatable, Sendable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
}
public struct Preferences: Codable, Equatable, Sendable {
    public var currency: String; public var theme: String; public var palette: String
    public var weekOutlierFilter: Bool?; public var reportChartPreferences: [String: JSONValue]?
    public init(currency: String = "AUD", theme: String = "system", palette: String = "mono") { self.currency = currency; self.theme = theme; self.palette = palette }
}
public struct Series: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var anchor: String
    public var through: String
    public var rule: RepeatRule?
    public var template: Entry
    public init(id: String, anchor: String, through: String, rule: RepeatRule?, template: Entry) {
        self.id = id; self.anchor = anchor; self.through = through; self.rule = rule; self.template = template
    }
}
public extension ISO8601DateFormatter {
    static var fractional: ISO8601DateFormatter { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }
}
public enum Day {
    public static var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(secondsFromGMT: 0)!; return c }
    public static func date(_ value: String) -> Date? {
        guard value.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil,
              value >= "1900-01-01", value <= "9999-12-31" else { return nil }
        let p = value.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, let d = calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)), key(d) == value else { return nil }
        return d
    }
    public static func valid(_ value: String) -> Bool { date(value) != nil }
    public static func key(_ date: Date, local: Bool = false) -> String {
        var c = calendar; if local { c.timeZone = .current }
        let d = c.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", d.year!, d.month!, d.day!)
    }
    public static var today: String { key(Date(), local: true) }
    public static func occurrence(anchor: String, rule: RepeatRule, index: Int) throws -> String {
        guard rule.isValid, index >= 0, index <= 100_000, let start = date(anchor) else { throw LedgerError("Invalid repeat schedule.") }
        let c = calendar
        let result: Date?
        if rule.unit == "day" || rule.unit == "week" {
            result = c.date(byAdding: .day, value: index * rule.every * (rule.unit == "week" ? 7 : 1), to: start)
        } else {
            let components = c.dateComponents([.year, .month, .day], from: start)
            let first = c.date(from: DateComponents(year: components.year, month: components.month, day: 1, hour: 12))!
            guard let target = c.date(byAdding: .month, value: index * rule.every * (rule.unit == "year" ? 12 : 1), to: first),
                  let range = c.range(of: .day, in: .month, for: target) else { throw LedgerError("Repeat date out of range.") }
            result = c.date(byAdding: .day, value: min(components.day!, range.count) - 1, to: target)
        }
        guard let result else { throw LedgerError("Repeat date out of range.") }
        return key(result)
    }
}
