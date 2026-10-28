import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTypeScript } from "../scripts/load-typescript.mjs";
const transfer = await loadTypeScript(new URL("../lib/ledger-transfer.ts", import.meta.url));
const storageTools = await loadTypeScript(new URL("../lib/ledger-import-storage.ts", import.meta.url));
const legacy = await readFile(new URL("../fixtures/legacy-test.csv", import.meta.url), "utf8");
const v2 = await readFile(new URL("../fixtures/recurring-test-v2.csv", import.meta.url), "utf8");
const json = await readFile(new URL("../fixtures/complete-test-backup.json", import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const empty = () => ({ transactions: [], deletedTransactions: [], categories: [], repeatMarks: {}, preferences: { currency: "AUD", theme: "system", palette: "mono" } });
function memoryStorage(initial = {}, failure = () => false) {
  const values = new Map(Object.entries(initial)); let writes = 0;
  return { values, getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key), setItem: (key, value) => { writes++; if (failure(key, writes)) throw new Error("QuotaExceededError"); values.set(key, value); } };
}
const transactionKey = "bros-ledger:transactions:v1", categoriesKey = "bros-ledger:categories:v1";

test("legacy fixture contains 24 entries and exact expected income and expense totals", () => {
  const parsed = transfer.parseImport(legacy, "AUD");
  assert.equal(parsed.kind, "legacy-csv"); assert.equal(parsed.transactions.length, 24);
  assert.equal(parsed.transactions.filter(e => e.type === "expense").reduce((a, b) => a + b.amountCents, 0), 158383);
  assert.equal(parsed.transactions.filter(e => e.type === "income").reduce((a, b) => a + b.amountCents, 0), 560015);
  assert.ok(parsed.transactions.some(e => e.note.includes('\n') && e.note.includes('"weekend"')));
});

test("CSV v2 round-trip preserves IDs, currencies, tags, repeat rules, anchors and deletion progress", () => {
  const original = transfer.parseImport(json, "AUD");
  const restored = transfer.parseImport(transfer.transactionsToCsv(original), "EUR");
  assert.equal(restored.kind, "csv-v2");
  assert.deepEqual(plain(restored.transactions), plain(original.transactions));
  for (const [id, through] of Object.entries(original.repeatMarks)) assert.equal(restored.repeatMarks[id], through);
  assert.equal(restored.transactions.find(e => e.id === "demo-usd").currency, "USD");
  assert.equal(restored.transactions.find(e => e.id === "demo-stopped").repeat, null);
});

test("complete backup round-trip includes Bin, category order, chart settings and preferences", () => {
  const original = transfer.parseImport(json, "AUD");
  const exported = transfer.createBackup(original);
  const restored = transfer.parseImport(JSON.stringify(exported), "USD");
  for (const key of ["transactions", "deletedTransactions", "categories", "repeatMarks", "preferences"]) assert.deepEqual(plain(restored[key]), plain(original[key]));
  assert.equal(restored.deletedTransactions.length, 3);
  assert.ok(!JSON.stringify(exported).includes("privacy-pin"));
});

test("repeated v2 imports neither duplicate entries nor overwrite edits or resurrect Bin entries", () => {
  const parsed = transfer.parseImport(v2, "AUD");
  const first = transfer.mergeImport(empty(), parsed);
  const edited = first.transactions.find(e => e.id === "demo-weekly"); edited.note = "My newer edit";
  const removed = first.transactions.find(e => e.id === "demo-usd"); first.transactions = first.transactions.filter(e => e.id !== removed.id);
  first.deletedTransactions.push({ ...removed, deletedAt: new Date().toISOString() });
  const second = transfer.mergeImport(first, parsed);
  assert.equal(second.added, 0); assert.equal(second.skipped, 10); assert.ok(second.conflicts >= 2);
  assert.equal(second.transactions.find(e => e.id === "demo-weekly").note, "My newer edit");
  assert.ok(!second.transactions.some(e => e.id === "demo-usd"));
});

test("legacy reimports detect records previously imported by the old random-ID importer", () => {
  const parsed = transfer.parseImport(legacy, "AUD");
  const current = { ...empty(), transactions: parsed.transactions.map((e, i) => ({ ...e, id: `old-random-${i}` })) };
  const merged = transfer.mergeImport(current, parsed);
  assert.equal(merged.added, 0); assert.equal(merged.skipped, 24);
});

test("legacy identical purchases remain distinct and row reordering does not duplicate them", () => {
  const header = "Date,Category,Note,Account,Amount\n";
  const a = "2026-10-01,Dine,Coffee,Everyday,-5\n", b = "2026-10-02,Dine,Tea,Everyday,-3\n";
  const first = transfer.mergeImport(empty(), transfer.parseImport(header + a + a + b, "AUD"));
  assert.equal(first.added, 3);
  const reordered = transfer.mergeImport(first, transfer.parseImport(header + b + a + a, "AUD"));
  assert.equal(reordered.added, 0); assert.equal(reordered.skipped, 3);
  const extended = transfer.mergeImport(first, transfer.parseImport(header + a + a + a + b, "AUD"));
  assert.equal(extended.added, 1);
});

test("importing metadata keeps a stopped series stopped and merges progress monotonically", () => {
  const parsed = transfer.parseImport(v2, "AUD");
  const current = { ...empty(), transactions: [{ ...parsed.transactions[0], repeat: null }], repeatMarks: { "demo-monthly": "2026-02-28" } };
  const merged = transfer.mergeImport(current, parsed);
  assert.equal(merged.repeatMarks["demo-monthly"], "2026-09-30");
  assert.ok(merged.transactions.filter(e => e.seriesId === "demo-monthly").every(e => e.repeat === null));
});

test("an empty ledger restores categories and preferences; an existing ledger keeps its settings", () => {
  const parsed = transfer.parseImport(json, "AUD");
  const restored = transfer.mergeImport(empty(), parsed);
  assert.equal(restored.preferences.palette, "ocean");
  assert.deepEqual(plain(restored.categories), plain(parsed.categories));
  const existing = transfer.mergeImport({ ...empty(), transactions: [transfer.parseImport(legacy, "AUD").transactions[0]] }, parsed);
  assert.equal(existing.preferences.palette, "mono");
});

test("an invalid final row rejects the whole CSV rather than partially importing it", () => {
  const bad = 'Date,Category,Note,Account,Amount\n2026-10-01,Dine,Good,Everyday,-1\n2026-02-30,Dine,Bad,Everyday,-1';
  assert.throws(() => transfer.parseImport(bad, "AUD"), /row 3/);
  assert.throws(() => transfer.parseImport(bad.replace("2026-02-30", "2026-10-02").replace(/-1$/, "NaN"), "AUD"));
});

test("malformed quotes, missing repeat columns, duplicate IDs and invalid rules are rejected", () => {
  assert.throws(() => transfer.parseCsvRows('Date,Note\n2026-10-01,"Unclosed'));
  assert.throws(() => transfer.parseImport('Date,Category,Note,Account,Amount,Repeat Unit\n2026-10-01,Dine,X,Everyday,-1,day', "AUD"));
  const backup = JSON.parse(json); backup.transactions.push(backup.transactions[0]);
  assert.throws(() => transfer.parseImport(JSON.stringify(backup), "AUD"), /duplicate IDs/);
  const invalid = JSON.parse(json); invalid.transactions[0].repeat.every = 0;
  assert.throws(() => transfer.parseImport(JSON.stringify(invalid), "AUD"), /repeat rule/);
  invalid.transactions[0].repeat.every = 1;
  Object.defineProperty(invalid.repeatMarks, "__proto__", { value: "2026-10-28", enumerable: true });
  assert.throws(() => transfer.parseImport(JSON.stringify(invalid), "AUD"), /generation progress/);
});

test("unknown backup versions and invalid preferences never reach a merge", () => {
  const backup = JSON.parse(json); backup.version = 99;
  assert.throws(() => transfer.parseImport(JSON.stringify(backup), "AUD"), /Unsupported/);
  backup.version = 2; backup.preferences.currency = "not-a-currency";
  assert.throws(() => transfer.parseImport(JSON.stringify(backup), "AUD"), /preferences/);
});

test("successful imports retain an exact downloadable pre-import snapshot without changing the PIN", () => {
  const storage = memoryStorage({ [transactionKey]: "old", "bros-ledger:privacy-pin-hash:v1": "unchanged" });
  storageTools.writeImportAtomically(storage, { [transactionKey]: "new", [categoriesKey]: "categories" });
  assert.equal(storage.getItem(transactionKey), "new");
  assert.equal(storage.getItem("bros-ledger:privacy-pin-hash:v1"), "unchanged");
  const old = storageTools.preImportValues(storage);
  assert.equal(old[transactionKey], "old"); assert.equal(old[categoriesKey], null);
});

test("quota failure before creating a recovery backup leaves all original data intact", () => {
  const storage = memoryStorage({ [transactionKey]: "original" }, key => key === storageTools.importJournalKey);
  assert.throws(() => storageTools.writeImportAtomically(storage, { [transactionKey]: "new" }), /Nothing was imported/);
  assert.equal(storage.getItem(transactionKey), "original");
});

test("a failed later write restores every original key, including originally absent keys", () => {
  const storage = memoryStorage({ [transactionKey]: "original" }, (key, n) => key === categoriesKey && n === 3);
  assert.throws(() => storageTools.writeImportAtomically(storage, { [transactionKey]: "new", [categoriesKey]: "new categories" }), /previous ledger was restored/);
  assert.equal(storage.getItem(transactionKey), "original"); assert.equal(storage.getItem(categoriesKey), null);
  assert.equal(JSON.parse(storage.getItem(storageTools.importJournalKey)).state, "done");
});

test("an interrupted tab import is recovered from its persisted journal on reopening", () => {
  const journal = { version: 1, state: "pending", createdAt: new Date().toISOString(), previous: { [transactionKey]: "original", [categoriesKey]: null } };
  const storage = memoryStorage({ [transactionKey]: "partly imported", [categoriesKey]: "new", [storageTools.importJournalKey]: JSON.stringify(journal) });
  assert.equal(storageTools.recoverPendingImport(storage), true);
  assert.equal(storage.getItem(transactionKey), "original"); assert.equal(storage.getItem(categoriesKey), null);
  assert.equal(storageTools.recoverPendingImport(storage), false);
});

test("persistent recovery failures keep the journal pending and explicitly stop editing", () => {
  const storage = memoryStorage({ [transactionKey]: "original" }, (key, n) => key === categoriesKey || (key === transactionKey && n > 2));
  assert.throws(() => storageTools.writeImportAtomically(storage, { [transactionKey]: "new", [categoriesKey]: "new" }), /Stop editing/);
  assert.equal(JSON.parse(storage.getItem(storageTools.importJournalKey)).state, "pending");
});

test("the journal cannot write PIN keys or arbitrary browser storage", () => {
  const storage = memoryStorage();
  assert.throws(() => storageTools.writeImportAtomically(storage, { "bros-ledger:privacy-pin-hash:v1": "overwrite" }), /Unsupported/);
  assert.equal(storage.values.size, 0);
});

test("invalid currency, malformed amount grouping and extra decimals are rejected", () => {
  const header = 'Date,Category,Note,Account,Amount\n2026-10-01,Dine,Test,Everyday,';
  for (const amount of ['"-1,23"', '1e2', '0', '-0.001', 'Infinity', 'NaN']) assert.throws(() => transfer.parseImport(header + amount, "AUD"));
  assert.equal(transfer.parseImport(header + '"-$1,234.56"', "AUD").transactions[0].amountCents, 123456);
  assert.throws(() => transfer.parseImport(header + '-1', "invalid"));
});

test("merge reports changed repeat settings while retaining the current rule", () => {
  const original = transfer.parseImport(v2, "AUD");
  const current = transfer.mergeImport(empty(), original);
  current.transactions = current.transactions.map(e => e.seriesId === "demo-monthly" ? { ...e, repeat: null } : e);
  const merged = transfer.mergeImport(current, original);
  assert.ok(merged.conflicts >= 2);
  assert.ok(merged.transactions.filter(e => e.seriesId === "demo-monthly").every(e => e.repeat === null));
});

test("a manually moved entry may precede its original repeat anchor", () => {
  const backup = JSON.parse(json);
  backup.transactions[0].occurredAt = "2025-12-15";
  const imported = transfer.parseImport(JSON.stringify(backup), "AUD");
  const exported = transfer.parseImport(transfer.transactionsToCsv(imported), "AUD");
  assert.equal(exported.transactions[0].occurredAt, "2025-12-15");
  assert.equal(exported.transactions[0].seriesAnchor, "2026-01-31");
});

test("a normal legacy CSV can include a Currency column without pretending to have repeat metadata", () => {
  const csv = "Date,Category,Note,Account,Amount,Currency\n2026-01-01,Other,Test,Cash,-12.00,USD";
  const parsed = transfer.parseImport(csv, "AUD");
  assert.equal(parsed.kind, "legacy-csv"); assert.equal(parsed.transactions[0].currency, "USD");
});
