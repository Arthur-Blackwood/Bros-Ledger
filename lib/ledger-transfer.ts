/** Versioned, browser-independent ledger transfers. No storage is changed by parsing or merging. */
export type RepeatRule = { every: number; unit: "day" | "week" | "month" | "year" };
export type Entry = {
  id: string; occurredAt: string; type: "expense" | "income"; amountCents: number; currency: string;
  category: string; account: string; note: string; tags: string[]; source: string;
  repeat?: RepeatRule | null; seriesId?: string; seriesAnchor?: string;
};
export type DeletedEntry = Entry & { deletedAt: string };
export type Category = { id: string; name: string; emoji: string; type: "expense" | "income" };
export type Preferences = { currency: string; theme: string; palette: string; weekOutlierFilter?: boolean; reportChartPreferences?: Record<string, unknown> };
export type LedgerData = { transactions: Entry[]; deletedTransactions: DeletedEntry[]; categories: Category[]; repeatMarks: Record<string, string>; preferences: Preferences };
export type Backup = LedgerData & { format: "bros-ledger-backup"; version: 2; exportedAt: string };
export type ParsedImport = LedgerData & { kind: "legacy-csv" | "csv-v2" | "backup"; hasPreferences: boolean };
export type MergeResult = LedgerData & { added: number; skipped: number; conflicts: number };
export const csvColumns = ["Date", "Category", "Note", "Account", "Amount", "Currency", "ID", "Series ID", "Repeat Every", "Repeat Unit", "Series Anchor", "Generated Through", "Source", "Tags"];
const maxEntries = 100_000;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const safeID = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(value) && !["constructor", "prototype", "__proto__"].includes(value);
const currencyCode = (value: unknown): value is string => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const text = (value: unknown): value is string => typeof value === "string";
export const validDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || value > "9999-12-31") return false;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const validRule = (value: unknown): value is RepeatRule => isObject(value) && Number.isInteger(value.every) && Number(value.every) >= 1 && Number(value.every) <= 365 && ["day", "week", "month", "year"].includes(String(value.unit));
function validateEntry(value: unknown, deleted = false): asserts value is Entry | DeletedEntry {
  if (!isObject(value) || !safeID(value.id) || !validDay(value.occurredAt) || !["expense", "income"].includes(String(value.type)) || !Number.isSafeInteger(value.amountCents) || Number(value.amountCents) <= 0 || !currencyCode(value.currency) || !text(value.category) || !value.category.trim() || !text(value.account) || !value.account.trim() || !text(value.note) || !Array.isArray(value.tags) || !value.tags.every(text) || !text(value.source)) throw new Error("The file contains an invalid transaction.");
  if (value.repeat != null && !validRule(value.repeat)) throw new Error(`Invalid repeat rule for ${value.id}.`);
  if (value.seriesId !== undefined && !safeID(value.seriesId)) throw new Error("Invalid series ID.");
  if (value.seriesAnchor !== undefined && !validDay(value.seriesAnchor)) throw new Error("Invalid original series date.");
  if (deleted ? !text(value.deletedAt) || !Number.isFinite(Date.parse(value.deletedAt)) : value.deletedAt !== undefined) throw new Error("Invalid Bin record.");
}
function validateIDs(entries: Entry[]) {
  if (entries.length > maxEntries || new Set(entries.map(e => e.id)).size !== entries.length) throw new Error("Too many transactions or duplicate IDs in this file.");
}
export function parseCsvRows(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, "");
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false; let closed = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error("Invalid CSV quoting.");
      quoted = true;
    } else if (c === ",") { row.push(field); field = ""; closed = false; }
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field); if (row.some(v => v.trim())) rows.push(row);
      row = []; field = ""; closed = false;
    } else { if (closed) throw new Error("Unexpected text after a CSV quote."); field += c; }
  }
  if (quoted) throw new Error("The CSV contains an unclosed quote.");
  if (field || row.length || closed) { row.push(field); if (row.some(v => v.trim())) rows.push(row); }
  if (rows.length > maxEntries + 1) throw new Error("This file has too many transactions.");
  return rows;
}
function parseAmount(raw: string): { amountCents: number; type: Entry["type"] } {
  const numeric = raw.trim().replace("−", "-").replace(/^([+-]?)(?:[A-Z]{3}\s*|[$€£¥])/, "$1");
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(numeric)) throw new Error("Use a nonzero amount with at most two decimal places.");
  const normalized = numeric.replaceAll(",", "");
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = normalized.replace(/^[+-]/, "").split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (cents <= BigInt(0) || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The amount is outside the supported range.");
  return { amountCents: Number(cents), type: negative ? "expense" : "income" };
}
function fingerprint(entry: Entry): string {
  return JSON.stringify([entry.occurredAt, entry.type, entry.amountCents, entry.currency, entry.category, entry.account, entry.note]);
}
// A stable legacy identity makes re-imports safe without requiring an ID column.
// Identical purchases are counted separately, including when rows are reordered.
function legacyID(key: string, occurrence: number): string {
  let hash = BigInt("14695981039346656037");
  for (const byte of new TextEncoder().encode(key)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * BigInt("1099511628211"));
  return `csv:${hash.toString(16).padStart(16, "0")}:${occurrence}`;
}
function csvImport(input: string, currency: string): ParsedImport {
  const rows = parseCsvRows(input);
  if (rows.length < 2) throw new Error("The CSV file has no transactions.");
  const headers = rows[0].map(s => s.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error("Duplicate CSV columns.");
  if (csvColumns.slice(0, 5).some(name => !headers.includes(name.toLowerCase()))) throw new Error("Use the Bro's Ledger CSV columns: Date, Category, Note, Account and Amount.");
  const version2 = csvColumns.slice(6, 12).some(name => headers.includes(name.toLowerCase()));
  if (version2 && csvColumns.slice(5, 12).some(name => !headers.includes(name.toLowerCase()))) throw new Error("The CSV has incomplete repeat metadata. Use a complete CSV v2 export.");
  const occurrences = new Map<string, number>(); const repeatMarks: Record<string, string> = {};
  const transactions = rows.slice(1).map((row, i): Entry => {
    try {
      if (row.length !== headers.length) throw new Error("Column count does not match the header.");
      const get = (name: string) => row[headers.indexOf(name)] ?? "";
      const money = parseAmount(get("amount"));
      const e: Entry = { id: "pending", occurredAt: get("date").trim(), ...money, currency: get("currency").trim() || currency,
        category: get("category").trim() || (money.type === "income" ? "Income" : "Other"), account: get("account").trim() || "Everyday", note: get("note"), tags: [], source: get("source") || "csv" };
      if (version2) {
        e.id = get("id").trim(); e.seriesId = get("series id").trim(); e.seriesAnchor = get("series anchor").trim();
        const every = get("repeat every").trim(); const unit = get("repeat unit").trim();
        if ((every || unit) && (!/^\d+$/.test(every) || !validRule({ every: Number(every), unit }))) throw new Error("Invalid repeat interval or unit.");
        e.repeat = every ? { every: Number(every), unit: unit as RepeatRule["unit"] } : null;
        if (!safeID(e.seriesId) || !validDay(e.seriesAnchor)) throw new Error("Missing series identity or original date.");
        const through = get("generated through").trim();
        if (!validDay(through) || through < e.occurredAt) throw new Error("Invalid generation progress.");
        repeatMarks[e.seriesId] = repeatMarks[e.seriesId] && repeatMarks[e.seriesId] > through ? repeatMarks[e.seriesId] : through;
        const tags = get("tags"); if (tags) e.tags = JSON.parse(tags);
      } else {
        const key = fingerprint(e); const n = (occurrences.get(key) ?? 0) + 1; occurrences.set(key, n); e.id = legacyID(key, n);
      }
      validateEntry(e); return e;
    } catch (error) { throw new Error(`CSV row ${i + 2}: ${error instanceof Error ? error.message : "invalid data"}`); }
  });
  validateIDs(transactions);
  return { kind: version2 ? "csv-v2" : "legacy-csv", transactions, deletedTransactions: [], categories: [], repeatMarks, preferences: { currency, theme: "system", palette: "mono" }, hasPreferences: false };
}
export function transactionsFromCsv(input: string, currency: string): Entry[] { return csvImport(input, currency).transactions; }
export function parseImport(input: string, currency: string): ParsedImport {
  if (new TextEncoder().encode(input).length > 50_000_000) throw new Error("Choose a file smaller than 50 MB.");
  if (!input.replace(/^\uFEFF/, "").trimStart().startsWith("{")) return csvImport(input, currency);
  const value: unknown = JSON.parse(input.replace(/^\uFEFF/, ""));
  if (!isObject(value) || value.format !== "bros-ledger-backup" || value.version !== 2 || !text(value.exportedAt) || !Number.isFinite(Date.parse(value.exportedAt))) throw new Error("Unsupported or invalid ledger backup.");
  if (!Array.isArray(value.transactions) || !Array.isArray(value.deletedTransactions) || !Array.isArray(value.categories) || !isObject(value.repeatMarks) || !isObject(value.preferences)) throw new Error("The backup is missing required ledger data.");
  for (const e of value.transactions) validateEntry(e);
  for (const e of value.deletedTransactions) validateEntry(e, true);
  validateIDs([...value.transactions, ...value.deletedTransactions] as Entry[]);
  for (const c of value.categories) if (!isObject(c) || !safeID(c.id) || !text(c.name) || !c.name.trim() || !text(c.emoji) || !["expense", "income"].includes(String(c.type))) throw new Error("Invalid category in backup.");
  if (new Set(value.categories.map(c => c.id)).size !== value.categories.length) throw new Error("Duplicate category IDs.");
  for (const [id, day] of Object.entries(value.repeatMarks)) if (!safeID(id) || !validDay(day)) throw new Error("Invalid series generation progress.");
  const p = value.preferences;
  if (!currencyCode(p.currency) || !["system", "light", "dark"].includes(String(p.theme)) || !["mono", "forest", "ocean", "indigo", "plum", "terracotta"].includes(String(p.palette)) || (p.weekOutlierFilter !== undefined && typeof p.weekOutlierFilter !== "boolean") || (p.reportChartPreferences !== undefined && !isObject(p.reportChartPreferences))) throw new Error("Invalid preferences in backup.");
  return { ...(value as unknown as LedgerData), kind: "backup", hasPreferences: true };
}
export function seriesMetadata(data: LedgerData): { anchors: Map<string, string>; through: Map<string, string> } {
  const anchors = new Map<string, string>(); const through = new Map<string, string>(Object.entries(data.repeatMarks));
  for (const e of [...data.transactions, ...data.deletedTransactions]) {
    const id = e.seriesId ?? e.id; const anchor = e.seriesAnchor ?? e.occurredAt;
    if (!anchors.has(id) || anchor < anchors.get(id)!) anchors.set(id, anchor);
    if (!through.has(id) || e.occurredAt > through.get(id)!) through.set(id, e.occurredAt);
  }
  return { anchors, through };
}
export function createBackup(data: LedgerData): Backup {
  const { anchors } = seriesMetadata(data);
  const anchored = <T extends Entry>(entries: T[]) => entries.map(e => ({ ...e, seriesAnchor: anchors.get(e.seriesId ?? e.id)! }));
  return { ...data, transactions: anchored(data.transactions), deletedTransactions: anchored(data.deletedTransactions), format: "bros-ledger-backup", version: 2, exportedAt: new Date().toISOString() };
}
export function transactionsToCsv(data: LedgerData, selected = data.transactions): string {
  const { anchors, through } = seriesMetadata(data);
  const rows = selected.map(e => {
    const id = e.seriesId ?? e.id;
    const amount = `${e.type === "expense" ? "-" : ""}${Math.floor(e.amountCents / 100)}.${String(e.amountCents % 100).padStart(2, "0")}`;
    return [e.occurredAt, e.category, e.note, e.account, amount, e.currency, e.id, id, e.repeat?.every ?? "", e.repeat?.unit ?? "", anchors.get(id)!, through.get(id)!, e.source, JSON.stringify(e.tags)];
  });
  return "\uFEFF" + [csvColumns, ...rows].map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(",")).join("\r\n");
}
export function mergeImport(current: LedgerData, incoming: ParsedImport): MergeResult {
  const transactions = [...current.transactions]; const deletedTransactions = [...current.deletedTransactions];
  const existingSeries = new Set([...transactions, ...deletedTransactions].map(e => e.seriesId ?? e.id));
  const existingTemplates = new Map<string, Entry>();
  for (const e of [...current.transactions].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) existingTemplates.set(e.seriesId ?? e.id, e);
  const known = new Map([...transactions, ...deletedTransactions].map(e => [e.id, e]));
  const legacyCounts = new Map<string, number>();
  for (const e of known.values()) legacyCounts.set(fingerprint(e), (legacyCounts.get(fingerprint(e)) ?? 0) + 1);
  const seenLegacy = new Map<string, number>();
  let added = 0; let skipped = 0; let conflicts = 0;
  for (const original of [...incoming.transactions, ...incoming.deletedTransactions]) {
    const copy = { ...original, tags: [...original.tags], repeat: original.repeat ? { ...original.repeat } : original.repeat };
    const id = original.seriesId ?? original.id;
    const template = existingTemplates.get(id);
    const e = incoming.kind !== "legacy-csv" && existingSeries.has(id) ? { ...copy, repeat: template?.repeat ? { ...template.repeat } : null } : copy;
    const legacyKey = fingerprint(e);
    const legacyN = (seenLegacy.get(legacyKey) ?? 0) + 1;
    seenLegacy.set(legacyKey, legacyN);
    const old = known.get(e.id);
    if (old) {
      skipped++;
      if (fingerprint(old) !== fingerprint(original) || JSON.stringify(old.repeat ?? null) !== JSON.stringify(original.repeat ?? null) || JSON.stringify(old.tags) !== JSON.stringify(original.tags) || ("deletedAt" in old) !== ("deletedAt" in original)) conflicts++;
      continue;
    }
    if (incoming.kind === "legacy-csv") {
      if (legacyN <= (legacyCounts.get(legacyKey) ?? 0)) { skipped++; continue; }
    }
    if ("deletedAt" in e) deletedTransactions.push(e as DeletedEntry); else transactions.push(e);
    known.set(e.id, e); added++;
  }
  const empty = current.transactions.length === 0 && current.deletedTransactions.length === 0;
  const categories = incoming.kind === "backup" && empty ? [...incoming.categories] : [...current.categories];
  for (const c of incoming.categories) if (!categories.some(old => old.id === c.id || old.name.toLowerCase() === c.name.toLowerCase())) categories.push(c);
  for (const e of transactions) if (!categories.some(c => c.name.toLowerCase() === e.category.toLowerCase())) categories.push({ id: crypto.randomUUID(), name: e.category, emoji: "✨", type: e.type });
  const repeatMarks = { ...current.repeatMarks };
  // Generation progress is monotonic across merges. Imported Bin records and
  // purged occurrences must not reappear just because this device was behind.
  for (const [id, day] of Object.entries(incoming.repeatMarks)) if (!Object.hasOwn(repeatMarks, id) || day > repeatMarks[id]) repeatMarks[id] = day;
  const preferences = incoming.hasPreferences && current.transactions.length === 0 && current.deletedTransactions.length === 0 ? incoming.preferences : current.preferences;
  return { transactions, deletedTransactions, categories, repeatMarks, preferences, added, skipped, conflicts };
}
