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
