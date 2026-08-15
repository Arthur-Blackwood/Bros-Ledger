# Bro’s Ledger

A private, local-first personal finance ledger. Every transaction, category and preference lives in your browser’s local storage — there is no account to create, no server-side database, and nothing to sign in to.

Built with Next.js 16 and React 19, bundled by Vite through [vinext](https://www.npmjs.com/package/vinext).

## Features

### Today

- Net cash flow for the current month, split into income and spending.
- A seven-day spending chart. Days with no spending render no bar at all, and any day with activity opens straight into its entries.
- Optional outlier filtering that caps the chart scale so a single unusual day does not flatten the rest of the week.
- A day-by-day transaction list. Click any row to edit it; hover to reveal delete.
- A copyable, auto-generated daily note.

### Reports

- **Spending by category** as a donut chart over a month, quarter or year, with an option to roll categories below 3% into *Other*.
- **Activity heat map** of the last 8, 16 or 26 weeks. Only days that actually moved money are marked.
- **Explorer chart** that groups income or spending by day, month or year and reports the total, highest, lowest and average.
- Interquartile-range outlier filtering, available on each chart independently.
- Chart settings are remembered between visits.

### Transactions

- The full ledger grouped by date, with inline editing and deletion.
- CSV import and export using the columns `Date, Category, Note, Account, Amount`. Positive amounts are treated as income, negative amounts as expenses. Categories that do not exist yet are created on import.

### Recently Deleted

Deleting an entry moves it here rather than discarding it. Each row shows how long it has left, and can be restored to the ledger or removed for good. Anything older than **30 days** is pruned automatically the next time the app loads.

On desktop this is its own sidebar section. On mobile — where the sidebar is hidden — it appears at the bottom of **Settings** instead, so there is no extra tab.

### Personalization

- Light, dark, or follow-the-system themes.
- Six colour palettes: **mono** (the default), forest, ocean, indigo, plum and terracotta.
- Custom categories with emoji, reorderable by drag.

## Privacy, honestly

Everything genuinely stays on your device. The app makes no outbound network requests, sets no cookies, loads no third-party scripts or fonts, and never puts data in the URL. CSV export builds the file in memory and never uploads it. The whole ledger UI is a client component, so the server never receives your data.

Because local storage is scoped to an origin and a browser profile, each browser, profile, device and private window keeps its own separate ledger. Nothing syncs between them.

### What the income PIN does and does not do

Income is hidden by default and revealed with a 5-digit PIN you set on first run. The PIN itself is never stored — only a PBKDF2-SHA-256 hash (120,000 iterations) and a random 16-byte salt.

**The PIN hides income in the interface. It does not encrypt your data.** Transactions are stored as plain JSON, so anyone who can open developer tools on your device can read the whole ledger, income included, without ever entering the PIN. Treat it as a shield against someone glancing at your screen, not as a lock on the data. While income is hidden it is also excluded from totals, charts and CSV exports — the export notice tells you exactly how many entries were withheld.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the URL printed in the terminal. Each browser profile starts with an empty ledger.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm start` | Serve the production build |
| `npm test` | Build, then run the smoke tests in `tests/` |
| `npm run lint` | Run ESLint across the project |

Run `npm test` and `npm run lint` before pushing a change.

## Project structure

```
app/             Application source: ledger UI, layout, PWA manifest, global styles
public/          Favicon, install icons and social image
tests/           Node test-runner smoke tests
worker/          Server entry point
```

Almost all of the interface lives in `app/ledger-app.tsx`.

## Where your data lives

Everything is stored under `bros-ledger:*` keys in the browser’s local storage:

| Key | Contents |
| --- | --- |
| `bros-ledger:transactions:v1` | Every transaction |
| `bros-ledger:deleted-transactions:v1` | The Recently Deleted bin |
| `bros-ledger:categories:v1` | Your categories and their order |
| `bros-ledger:privacy-pin-hash:v1` | PBKDF2 hash of the income PIN |
| `bros-ledger:privacy-pin-salt:v1` | Salt for that hash |
| `bros-ledger:theme:v1` | Theme preference |
| `bros-ledger:palette:v1` | Colour palette preference |
| `bros-ledger:week-outlier-filter:v1` | Seven-day chart outlier setting |
| `bros-ledger:report-chart-preferences:v1` | Saved report chart settings |

Two legacy `daylight-ledger:*` keys are read once and migrated forward.

Clearing site data, browsing privately, or moving to another browser or device means starting from an empty ledger. **Export a CSV regularly** — it is the only backup.
