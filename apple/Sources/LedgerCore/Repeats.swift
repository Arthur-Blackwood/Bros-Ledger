import Foundation

public enum Repeats {
    /// Match the browser: the latest surviving occurrence controls the next rule.
    /// Bin entries contribute the original anchor and high-water mark, not the active rule.
    public static func reconstruct(entries: [Entry], marks: [String: String]) -> [Series] {
        Dictionary(grouping: entries, by: { $0.seriesId ?? $0.id }).compactMap { id, members in
            let active = members.filter { $0.deletedAt == nil }.sorted { ($0.occurredAt, $0.id) < ($1.occurredAt, $1.id) }
            guard let latest = active.last else { return nil }
            let anchor = members.map { $0.seriesAnchor ?? $0.occurredAt }.min()!
            let through = (members.flatMap { [$0.occurredAt, $0.generatedThrough ?? $0.occurredAt] } + [marks[id] ?? ""]).max()!
            guard members.contains(where: { $0.repeat != nil }) || latest.seriesId != nil else { return nil }
            return Series(id: id, anchor: anchor, through: through, rule: latest.repeat, template: latest)
        }.sorted { $0.id < $1.id }
    }
    public static func materialise(series: [Series], existing: [Entry], today: String, limit: Int = 400) throws -> (entries: [Entry], series: [Series]) {
        guard Day.valid(today), limit > 0 else { throw LedgerError("Invalid generation date or limit.") }
        var known = Set(existing.map(\.id))
        var occupied = Set(existing.map { ($0.seriesId ?? $0.id) + "|" + $0.occurredAt })
        var created: [Entry] = []; var updated: [Series] = []
        for var schedule in series.sorted(by: { $0.id < $1.id }) {
            guard let rule = schedule.rule else { updated.append(schedule); continue }
            guard Day.valid(schedule.anchor), Day.valid(schedule.through), rule.isValid else { throw LedgerError("Invalid stored repeat schedule.") }
            if schedule.through >= today { updated.append(schedule); continue }
            // Derive a bounded upper limit instead of calculating dates tens of
            // thousands of years beyond the supported calendar range.
            let start = Day.date(schedule.anchor)!, cursor = Day.date(schedule.through)!
            let component: Calendar.Component = (rule.unit == "day" || rule.unit == "week") ? .day : .month
            let distance = Day.calendar.dateComponents([component], from: start, to: cursor).value(for: component) ?? 0
            let step = rule.every * (rule.unit == "week" ? 7 : rule.unit == "year" ? 12 : 1)
            var low = 1, high = min(100_000, max(1, max(0, distance) / step + 2))
            while low < high {
                let mid = (low + high) / 2
                let next = try Day.occurrence(anchor: schedule.anchor, rule: rule, index: mid)
                if Day.valid(next) && next <= schedule.through { low = mid + 1 } else { high = mid }
            }
            var index = low
            while created.count < limit, index <= 100_000 {
                let date = try Day.occurrence(anchor: schedule.anchor, rule: rule, index: index)
                if !Day.valid(date) || date > today { break }
                let id = "repeat:\(schedule.id):\(date)"
                let slot = schedule.id + "|" + date
                if !known.contains(id), !occupied.contains(slot) {
                    var entry = schedule.template
                    entry.id = id; entry.occurredAt = date; entry.seriesId = schedule.id
                    entry.seriesAnchor = schedule.anchor; entry.generatedThrough = nil
                    entry.source = "repeat"; entry.deletedAt = nil; entry.purged = nil; entry.repeat = rule
                    created.append(entry); known.insert(id); occupied.insert(slot)
                }
                schedule.through = date; index += 1
            }
            updated.append(schedule)
        }
        return (created, updated)
    }
}
