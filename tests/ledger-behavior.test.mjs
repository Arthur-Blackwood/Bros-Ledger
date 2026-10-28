import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the actual application helpers without mounting React or reading a
// browser profile. These cases supplement the existing source smoke checks.
const source = await readFile(new URL("../app/ledger-app.tsx", import.meta.url), "utf8");
const recurrence = source.slice(source.indexOf("const toDateKey ="), source.indexOf("const shiftMonthKey ="));
const pin = source.slice(source.indexOf("const bytesToBase64 ="), source.indexOf("const parseCsvRows ="));
const csv = source.slice(source.indexOf("const parseCsvRows ="), source.indexOf("const themePreferenceKey ="));
const binReader = source.slice(source.indexOf("const readDeletedTransactions ="), source.indexOf("const readLocalTransactions ="));
function helpers() {
  const storage = new Map();
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const context = vm.createContext({ crypto: webcrypto, Date, TextEncoder, btoa, atob, window: { localStorage } });
  const script = `const deletedTransactionsKey = "bin"; const deletedRetentionDays = 30;
    const privacyPinHashKey = "hash"; const privacyPinSaltKey = "salt";
    ${recurrence}\n${pin}\n${csv}\n${binReader}
    globalThis.api = { occurrenceAfter, materialiseRepeats, withSeriesAnchors, restoreDeletedEntry,
      createPrivacyPin, verifyPrivacyPin, transactionsFromCsv, readDeletedTransactions };`;
  vm.runInContext(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { ...context.api, storage };
}
const entry = (changes = {}) => ({
  id: "series-a", seriesId: "series-a", occurredAt: "2026-01-31", type: "expense",
  amountCents: 1200, currency: "AUD", category: "Subscription", account: "Everyday",
  note: "Monthly", tags: ["test"], source: "manual", repeat: { every: 1, unit: "month" }, ...changes,
});

test("monthly and leap-year occurrences retain their original day", () => {
  const { occurrenceAfter } = helpers();
  assert.equal(occurrenceAfter("2026-01-31", { every: 1, unit: "month" }, 1), "2026-02-28");
  assert.equal(occurrenceAfter("2026-01-31", { every: 1, unit: "month" }, 2), "2026-03-31");
  assert.equal(occurrenceAfter("2024-02-29", { every: 1, unit: "year" }, 1), "2025-02-28");
  assert.equal(occurrenceAfter("2024-02-29", { every: 1, unit: "year" }, 4), "2028-02-29");
});

test("a deleted anchor is recovered from legacy Bin history and persisted on survivors", () => {
  const { withSeriesAnchors, materialiseRepeats } = helpers();
  const survivors = withSeriesAnchors([entry({ id: "feb", occurredAt: "2026-02-28" })], [entry({ deletedAt: new Date().toISOString() })]);
  assert.equal(survivors[0].seriesAnchor, "2026-01-31");
  // Bin may now be purged; the persisted survivor still knows the original day.
  const due = materialiseRepeats(JSON.parse(JSON.stringify(survivors)), "2026-03-31", { "series-a": "2026-02-28" });
  assert.equal(due.created.length, 1);
  assert.equal(due.created[0].occurredAt, "2026-03-31");
  assert.equal(due.created[0].seriesAnchor, "2026-01-31");
});

test("expired Bin history can recover an anchor before normal retention pruning", () => {
  const { storage, readDeletedTransactions, withSeriesAnchors } = helpers();
  storage.set("bin", JSON.stringify([entry({ deletedAt: new Date(Date.now() - 31 * 86400000).toISOString() })]));
  assert.equal(readDeletedTransactions().length, 0);
  const history = readDeletedTransactions(true);
  assert.equal(history.length, 1);
  const survivors = withSeriesAnchors([entry({ id: "feb", occurredAt: "2026-02-28" })], history);
  assert.equal(survivors[0].seriesAnchor, "2026-01-31");
});

test("restoring a Bin entry retains its schedule and all other transaction metadata", () => {
  const { restoreDeletedEntry, materialiseRepeats } = helpers();
  const original = entry({ seriesAnchor: "2026-01-31", deletedAt: new Date().toISOString(), extraMetadata: "preserve" });
  const restored = restoreDeletedEntry(original);
  const expected = { ...original }; delete expected.deletedAt;
  assert.equal(JSON.stringify(restored), JSON.stringify(expected));
  assert.ok(original.deletedAt, "restoring must not mutate Bin history used by Undo");
  assert.equal(materialiseRepeats([restored], "2026-02-28", {}).created[0].occurredAt, "2026-02-28");
});

test("restoring a stopped repeat does not restart it", () => {
  const { restoreDeletedEntry, materialiseRepeats } = helpers();
  const restored = restoreDeletedEntry(entry({ repeat: null, deletedAt: new Date().toISOString() }));
  assert.equal(materialiseRepeats([restored], "2026-10-28", {}).created.length, 0);
});

test("catch-up is idempotent and watermark prevents deleted occurrences from returning", () => {
  const { materialiseRepeats } = helpers();
  const due = materialiseRepeats([entry()], "2026-03-31", {});
  assert.equal(due.created.length, 2);
  assert.equal(materialiseRepeats([entry(), ...due.created], "2026-03-31", due.marks).created.length, 0);
  assert.equal(materialiseRepeats([entry()], "2026-03-31", due.marks).created.length, 0);
});

test("a watermark between scheduled dates does not skip the next due occurrence", () => {
  const { materialiseRepeats } = helpers();
  const due = materialiseRepeats([entry()], "2026-03-31", { "series-a": "2026-03-15" });
  assert.equal(due.created.length, 1);
  assert.equal(due.created[0].occurredAt, "2026-03-31");
});

test("the 400-entry catch-up cap applies across all series and resumes next load", () => {
  const { materialiseRepeats } = helpers();
  const first = entry({ occurredAt: "2020-01-01", repeat: { every: 1, unit: "day" } });
  const second = entry({ id: "series-b", seriesId: "series-b", occurredAt: "2020-01-01", repeat: { every: 1, unit: "day" } });
  const due = materialiseRepeats([first, second], "2026-10-28", {});
  assert.equal(due.created.length, 400);
  assert.equal(due.marks["series-b"], "2020-01-01");
  const resumed = materialiseRepeats([first, second, ...due.created], "2026-10-28", due.marks);
  assert.equal(resumed.created.length, 400);
  const ids = new Set(due.created.map(item => `${item.seriesId}:${item.occurredAt}`));
  assert.ok(resumed.created.every(item => !ids.has(`${item.seriesId}:${item.occurredAt}`)));
});

test("weekly and custom fortnightly intervals survive local daylight-saving changes", () => {
  const { occurrenceAfter } = helpers();
  assert.equal(occurrenceAfter("2026-10-03", { every: 1, unit: "day" }, 2), "2026-10-05");
  assert.equal(occurrenceAfter("2026-10-03", { every: 2, unit: "week" }, 1), "2026-10-17");
});

test("legacy CSV reads signed amounts and quoted multiline notes", () => {
  const { transactionsFromCsv } = helpers();
  const rows = transactionsFromCsv('\uFEFFDate,Category,Note,Account,Amount\r\n2026-01-31,Other,"One, two\nThree",Everyday,-12.50\r\n2026-02-01,Income,Pay,Everyday,100', "AUD");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amountCents, 1250);
  assert.equal(rows[0].note, "One, two\nThree");
  assert.equal(rows[1].type, "income");
  assert.throws(() => transactionsFromCsv("Date,Amount\n2026-01-31,-10", "AUD"));
});

test("the PIN still verifies correctly after copying the PBKDF2 salt buffer", async () => {
  const { createPrivacyPin, verifyPrivacyPin, storage } = helpers();
  await createPrivacyPin("12345");
  assert.equal(await verifyPrivacyPin("12345"), true);
  assert.equal(await verifyPrivacyPin("54321"), false);
  assert.equal(storage.get("hash").length, 64);
  assert.notEqual(storage.get("hash"), "12345");
});
