import { mkdir, writeFile } from "node:fs/promises";
const categories = ["Dine", "Shopping", "Transport", "Health", "Fun", "Subscription"];
let seed = 20261028;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const rows = Array.from({ length: 24 }, (_, index) => {
  const income = index === 0 || index === 12;
  const date = `2026-${String(9 + Math.floor(index / 12)).padStart(2, "0")}-${String(1 + (index % 12) * 2).padStart(2, "0")}`;
  const cents = income ? 250000 + Math.floor(random() * 50000) : 500 + Math.floor(random() * 15000);
  const note = index === 3 ? 'DEMO café, "weekend"\nSecond line' : `DEMO ${income ? "salary" : "purchase"} ${String(index + 1).padStart(2, "0")}`;
  return [date, income ? "Income" : categories[Math.floor(random() * categories.length)], note, index % 2 ? "Everyday" : "Savings", ((income ? 1 : -1) * cents / 100).toFixed(2)];
});
const csv = "\uFEFF" + [["Date", "Category", "Note", "Account", "Amount"], ...rows].map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(",")).join("\r\n");
const amounts = rows.map(row => Math.round(Number(row[4]) * 100));
const expected = { transactions: 24, expenses: 22, income: 2, expenseCents: -amounts.filter(v => v < 0).reduce((a, b) => a + b, 0), incomeCents: amounts.filter(v => v > 0).reduce((a, b) => a + b, 0), currency: "AUD", seed: 20261028 };
await mkdir("outputs/test-data", { recursive: true });
await writeFile("fixtures/legacy-test.csv", csv);
await writeFile("fixtures/legacy-test.expected.json", JSON.stringify(expected, null, 2) + "\n");
await writeFile("outputs/test-data/legacy-test.csv", csv);
console.log(expected);

// v2 uses explicit stable IDs and saved progress; all records are fictional.
const { loadTypeScript } = await import("./load-typescript.mjs");
const transfer = await loadTypeScript(new URL("../lib/ledger-transfer.ts", import.meta.url));
const demo = (id, date, series, rule, note, cents = 1500) => ({ id, occurredAt: date, type: "expense", amountCents: cents, currency: "AUD", category: "Subscription", account: "Everyday", note, tags: ["demo"], source: id.includes("copy") ? "repeat" : "manual", repeat: rule, seriesId: series, seriesAnchor: date });
const monthly = { every: 1, unit: "month" }, weekly = { every: 1, unit: "week" }, daily = { every: 1, unit: "day" }, yearly = { every: 1, unit: "year" };
const transactions = [
  demo("demo-monthly", "2026-01-31", "demo-monthly", monthly, "DEMO month-end subscription", 4599),
  { ...demo("demo-monthly-copy", "2026-02-28", "demo-monthly", monthly, "DEMO month-end subscription", 4599), seriesAnchor: "2026-01-31" },
  demo("demo-weekly", "2026-10-01", "demo-weekly", weekly, "DEMO weekly transport"),
  { ...demo("demo-weekly-copy", "2026-10-08", "demo-weekly", weekly, "DEMO weekly transport"), seriesAnchor: "2026-10-01" },
  demo("demo-daily", "2026-10-25", "demo-daily", daily, "DEMO daily coffee", 899),
  demo("demo-yearly", "2024-02-29", "demo-yearly", yearly, "DEMO leap-day membership", 19999),
  demo("demo-stopped", "2026-10-20", "demo-stopped", null, "DEMO stopped subscription", 999),
  demo("demo-custom", "2026-08-31", "demo-custom", { every: 2, unit: "month" }, 'DEMO custom, "two months"\nMultiline note', 2500),
  { ...demo("demo-income", "2026-10-01", "demo-income", null, "DEMO salary", 120000), type: "income", category: "Income" },
  { ...demo("demo-usd", "2026-10-10", "demo-usd", null, "DEMO USD purchase", 1150), currency: "USD" },
];
const deletedTransactions = [
  { ...demo("demo-monthly-deleted", "2026-03-31", "demo-monthly", monthly, "DEMO deleted month-end subscription", 4599), seriesAnchor: "2026-01-31", deletedAt: "2026-10-26T10:00:00.000Z" },
  { ...demo("demo-weekly-deleted", "2026-10-15", "demo-weekly", weekly, "DEMO deleted weekly transport"), seriesAnchor: "2026-10-01", deletedAt: "2026-10-26T10:00:00.000Z" },
  { ...demo("demo-daily-deleted", "2026-10-26", "demo-daily", daily, "DEMO deleted daily coffee", 899), seriesAnchor: "2026-10-25", deletedAt: "2026-10-27T10:00:00.000Z" },
];
const data = { transactions, deletedTransactions,
  categories: [{ id: "demo-cat-sub", name: "Subscription", emoji: "🔔", type: "expense" }, { id: "demo-cat-income", name: "Income", emoji: "💵", type: "income" }],
  repeatMarks: { "demo-monthly": "2026-09-30", "demo-weekly": "2026-10-15", "demo-daily": "2026-10-27", "demo-yearly": "2025-02-28", "demo-stopped": "2026-10-20", "demo-custom": "2026-08-31" },
  preferences: { currency: "AUD", theme: "system", palette: "ocean", weekOutlierFilter: true, reportChartPreferences: {} } };
const v2csv = transfer.transactionsToCsv(data); const backup = transfer.createBackup(data); backup.exportedAt = "2026-10-28T10:00:00.000Z";
const json = JSON.stringify(backup, null, 2) + "\n";
transfer.parseImport(v2csv, "AUD"); transfer.parseImport(json, "AUD");
for (const directory of ["fixtures", "outputs/test-data"]) {
  await writeFile(`${directory}/recurring-test-v2.csv`, v2csv);
  await writeFile(`${directory}/complete-test-backup.json`, json);
}
const expected2 = { activeTransactions: 10, binRecords: 3, activeSeries: 5, currencyCodes: ["AUD", "USD"], nextLoadDate: "2026-10-28", dueGenerated: ["2026-10-22 (weekly)", "2026-10-28 (daily)", "2026-02-28 (yearly)"], nextMonthly: "2026-10-31", nextCustom: "2026-10-31", stoppedSeriesGenerates: 0 };
await writeFile("fixtures/recurring-test-v2.expected.json", JSON.stringify(expected2, null, 2) + "\n");
console.log(expected2);
