// Run after ./apple/check-core.sh. Both files contain only generated demo data.
import { readFile } from "node:fs/promises";
import { loadTypeScript } from "./load-typescript.mjs";
const transfer = await loadTypeScript(new URL("../lib/ledger-transfer.ts", import.meta.url));
for (const [path, count, bin] of [
  ["/private/tmp/simple-ledger-native-checks/native-export.csv", 10, 0],
  ["/private/tmp/simple-ledger-native-checks/native-backup.json", 10, 3],
]) {
  const parsed = transfer.parseImport(await readFile(path, "utf8"), "AUD");
  if (parsed.transactions.length !== count || parsed.deletedTransactions.length !== bin || parsed.repeatMarks["demo-weekly"] !== "2026-10-15") throw new Error(`Cross-platform round-trip failed: ${path}`);
  if (parsed.transactions.find(entry => entry.id === "demo-usd")?.currency !== "USD") throw new Error(`Currency was lost: ${path}`);
  if (parsed.transactions.find(entry => entry.id === "demo-weekly")?.tags[0] !== "demo") throw new Error(`Tags were lost: ${path}`);
  console.log(`PASS Website reads native ${parsed.kind}: ${count} transactions, ${bin} Bin entries, currency, tags and repeat progress`);
}
