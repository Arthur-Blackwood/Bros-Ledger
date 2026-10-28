/** A persisted rollback journal protects multi-key localStorage imports, including interrupted tabs. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const importJournalKey = "bros-ledger:pre-import-backup:v1";
const allowed = new Set([
  "bros-ledger:transactions:v1", "bros-ledger:deleted-transactions:v1", "bros-ledger:categories:v1", "bros-ledger:repeat-marks:v1",
  "bros-ledger:currency:v1", "bros-ledger:theme:v1", "bros-ledger:palette:v1", "bros-ledger:week-outlier-filter:v1", "bros-ledger:report-chart-preferences:v1",
]);
type Journal = { version: 1; state: "pending" | "done"; createdAt: string; previous: Record<string, string | null> };
function readJournal(storage: StorageLike): Journal | null {
  const saved = storage.getItem(importJournalKey);
  if (!saved) return null;
  const value = JSON.parse(saved) as Journal;
  if (value.version !== 1 || !["pending", "done"].includes(value.state) || !value.previous || typeof value.previous !== "object" || Array.isArray(value.previous) || Object.entries(value.previous).some(([key, old]) => !allowed.has(key) || (old !== null && typeof old !== "string"))) throw new Error("The import recovery backup is invalid. Export your browser data before trying another import.");
  return value;
}
function restore(storage: StorageLike, journal: Journal) {
  for (const [key, old] of Object.entries(journal.previous)) {
    if (old === null) storage.removeItem(key); else storage.setItem(key, old);
  }
  storage.setItem(importJournalKey, JSON.stringify({ ...journal, state: "done" }));
}
export function recoverPendingImport(storage: StorageLike): boolean {
  const journal = readJournal(storage);
  if (!journal || journal.state !== "pending") return false;
  try { restore(storage, journal); return true; }
  catch { throw new Error("An interrupted import needs recovery. Do not edit this ledger or clear site data; the pre-import backup is preserved."); }
}
export function writeImportAtomically(storage: StorageLike, changes: Record<string, string>): void {
  if (Object.keys(changes).some(key => !allowed.has(key))) throw new Error("Unsupported import storage key.");
  recoverPendingImport(storage);
  const journal: Journal = { version: 1, state: "pending", createdAt: new Date().toISOString(), previous: Object.fromEntries(Object.keys(changes).map(key => [key, storage.getItem(key)])) };
  // If there is no room for the recovery backup, leave all ledger keys untouched.
  try { storage.setItem(importJournalKey, JSON.stringify(journal)); }
  catch { throw new Error("Not enough browser storage to save a recovery backup. Nothing was imported. Export a backup before freeing space."); }
  try {
    for (const [key, value] of Object.entries(changes)) storage.setItem(key, value);
    storage.setItem(importJournalKey, JSON.stringify({ ...journal, state: "done" }));
  } catch {
    try { restore(storage, journal); }
    catch { throw new Error("Import could not finish or fully roll back. Stop editing and reload to recover; the pre-import backup is preserved."); }
    throw new Error("Import could not be saved. Your previous ledger was restored.");
  }
}
export function preImportValues(storage: StorageLike): Record<string, string | null> | null {
  const journal = readJournal(storage);
  if (!journal || journal.state !== "done") return null;
  return journal.previous;
}
