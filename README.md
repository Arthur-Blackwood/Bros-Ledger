# Bro’s Ledger

A private, local-first personal finance ledger. Every transaction, category and preference lives in your browser’s local storage — there is no account to create, no server-side database, and nothing to sign in to.

Built with Next.js 16 and React 19, bundled by Vite through [vinext](https://www.npmjs.com/package/vinext).

## Features

### Today

- Net cash flow for a month, split into income and spending. Swipe the card or use its arrows to step back through previous months.
- A seven-day spending chart. Days with no spending render no bar at all, and any day with activity opens straight into its entries.
- Optional outlier filtering that caps the chart scale so a single unusual day does not flatten the rest of the week.
- A day-by-day transaction list. Click any row to edit it; hover to reveal delete.
- A copyable, auto-generated daily note.

### Reports

- **Spending by category** as a donut chart over a month, quarter or year, with an option to roll categories below 3% into *Other*.
- **Activity heat map** laid out as real calendar months, Monday-first, showing one month by default and switchable to 3 months, 6 months or the whole year. Each month stays visually separate and carries its own total, and the legend reports the average spending and income per month across the period. Each month reports its average spending and income per day, and multi-month views add a figure for the period as a whole. A month still running is averaged over the days so far, not the days it will have. Only days that actually moved money are marked, and clicking a day still opens it.
- **Explorer chart** that groups income or spending by day, month or year and reports the total, highest, lowest and average.
- Interquartile-range outlier filtering, available on each chart independently.
- Chart settings are remembered between visits.

### Transactions

- The full ledger grouped by date, with inline editing and deletion.
- CSV v2 import and export. The first five columns remain `Date, Category, Note, Account, Amount`; additional columns preserve currency, entry and series IDs, repeat rules, the original series date, generation progress, source and tags. Positive amounts are income and negative amounts are expenses. Five-column legacy files remain supported.
- Complete JSON backups include transactions, the Bin, category order, repeat progress, theme, palette, currency and chart preferences. The privacy PIN stays on this device. Unlock income before exporting a complete backup.
- Imports show a preview before saving, retain existing entries and save a downloadable pre-import backup.

### Repeating entries

Any entry can repeat: **Daily, Weekly, Fortnightly, Monthly, Yearly**, or a custom "every N days/weeks/months/years". The control sits in both the add and edit drawers and defaults to Never.

Occurrences that fell due while the app was closed are written in on the next load, tagged so they can be told apart from entries you typed. Three details worth knowing:

- Each occurrence is measured from the **original series date**, saved as `seriesAnchor` on every entry, so a monthly rule set on the 31st goes 31 January → 28 February → **31 March**. Deleting the first entry does not shift the schedule. Older ledgers recover that date from available Bin history before the Bin is pruned; dates already permanently removed by an older version cannot be reconstructed reliably.
- Deleting a generated entry **keeps it deleted**. A per-series high-water mark is stored in `bros-ledger:repeat-marks:v1`, so the generator never walks backwards.
- Generation is capped at 400 entries per load across all series, so a daily rule backdated by years cannot flood the ledger in one go. The next load continues from the saved progress.

Editing an entry updates the rule for everything generated after it; clearing the rule stops the series.

### Bin

Deleting an entry moves it to the Bin rather than discarding it. Each row shows how long it has left, and can be restored to the ledger or removed for good. Anything older than **30 days** is pruned automatically the next time the app loads.

Restoring preserves the original repeat rule, series identifier, and series date. A stopped rule stays stopped.

Restoring and permanently deleting are both undoable: the confirmation that appears offers an **Undo** for five seconds, after which it clears itself. Removing a category can be undone the same way.

On desktop the Bin is its own sidebar section. On mobile — where the sidebar is hidden — it appears at the bottom of **Settings** instead, so there is no extra tab.

### Settings

- Light, dark, or follow-the-system themes.
- Six colour palettes: **mono** (the default), forest, ocean, indigo, plum and terracotta.
- Custom categories with emoji, reorderable by drag.
- **Currency** picked automatically from your time zone, with a full picker to override it.


### Currency

On first run the currency is inferred from your time zone, falling back to your browser locale and then to USD. Time zone is the better signal: a device set to `en-US` while living in Sydney should still default to AUD, and language alone would get that wrong.

The full ISO 4217 list and its display names come from `Intl`, so no currency table is bundled for the picker. Decimal places follow each currency — yen and won correctly show none.

Each transaction stores the currency it was recorded in, so changing the setting affects new entries and totals without relabelling your history.

## Privacy, honestly

Everything genuinely stays on your device. Even currency detection is local — it reads your time zone through `Intl` rather than looking up your IP, so nothing is requested from a geolocation service. The app makes no outbound network requests, sets no cookies, loads no third-party scripts or fonts, and never puts data in the URL. CSV export builds the file in memory and never uploads it. The whole ledger UI is a client component, so the server never receives your data.

Because local storage is scoped to an origin and a browser profile, each browser, profile, device and private window keeps its own separate ledger. Nothing syncs between them.

### What the income PIN does and does not do

Income is hidden by default and revealed with a 5-digit PIN you set on first run. The PIN itself is never stored — only a PBKDF2-SHA-256 hash (120,000 iterations) and a random 16-byte salt.

**The PIN hides income in the interface. It does not encrypt your data.** Transactions are stored as plain JSON, so anyone who can open developer tools on your device can read the whole ledger, income included, without ever entering the PIN. Treat it as a shield against someone glancing at your screen, not as a lock on the data. While income is hidden it is also excluded from totals, charts and CSV exports — the export notice tells you exactly how many entries were withheld. Complete backups require unlocking income first.

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
| `npm test` | Build, then run source smoke checks and executable regression tests in `tests/` |
| `npm run typecheck` | Check application and Worker types without writing build cache files |
| `npm run lint` | Run ESLint across the project |

Run `npm test`, `npm run lint`, and `npm run typecheck` before pushing a change. Regression tests cover month-end and leap-year schedules, deletion and restoration, generation progress, the shared catch-up cap, legacy CSV, and PIN verification.

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
| `bros-ledger:deleted-transactions:v1` | The Bin |
| `bros-ledger:categories:v1` | Your categories and their order |
| `bros-ledger:privacy-pin-hash:v1` | PBKDF2 hash of the income PIN |
| `bros-ledger:privacy-pin-salt:v1` | Salt for that hash |
| `bros-ledger:theme:v1` | Theme preference |
| `bros-ledger:palette:v1` | Colour palette preference |
| `bros-ledger:currency:v1` | Display currency |
| `bros-ledger:repeat-marks:v1` | How far each repeating series has been generated |
| `bros-ledger:pre-import-backup:v1` | The ledger immediately before the most recent import, plus interrupted-import recovery state |
| `bros-ledger:week-outlier-filter:v1` | Seven-day chart outlier setting |
| `bros-ledger:report-chart-preferences:v1` | Saved report chart settings |

Two legacy `daylight-ledger:*` keys are read once and migrated forward.

Clearing site data, browsing privately, or moving to another browser or device means starting from an empty ledger. **Export complete JSON backups regularly.** CSV v2 preserves repeat settings for active entries; a complete backup also preserves the Bin, categories and preferences.

## Transfer and migration

1. In the original browser and original website address, unlock income. Choose **Complete backup** in Transactions and keep the JSON file. Browser storage belongs to that browser profile and address; a new local preview cannot read the original site's data.
2. In the destination ledger, choose **Import file** and select a JSON backup or CSV. Review counts, currencies, repeat settings and duplicates before confirming. Cancel changes nothing.
3. Existing IDs are kept, including records in the Bin. When a record differs, the existing record wins. Imports do not replace live series rules or restart a stopped series. Preferences and category order are restored to an empty ledger; an existing ledger keeps its settings.
4. Reopen the ledger to generate any repeating entries that fell due. Progress prevents previously deleted occurrences from being generated again. Monthly and yearly rules retain their original day, including month ends and leap years.
5. After an import, **Pre-import backup** downloads the previous ledger as a complete JSON backup. Only the latest pre-import snapshot is retained. Imports use a persisted rollback journal: insufficient storage rejects the import, later write failures restore the previous values, and an interrupted import is recovered before the app opens. Keep only one ledger tab open while importing.

A five-column legacy CSV has no repeat rules, recorded currency, or IDs. The importer uses the selected currency and compares exact transaction contents and occurrence counts to skip matching entries, including entries created by the old importer. If an old entry has since been edited, a legacy file cannot reliably identify it; review the proposed additions. Missing repeat rules cannot be inferred. Prefer CSV v2 or a complete backup when the original browser data is still available.

Backups and CSV files contain readable ledger data. Keep them private. The recovery journal stores only ledger data and preferences, never the PIN hash or salt. These transfer changes do not add a server database or device sync; native iCloud sync is a later phase.

### Reproducible demo data

Run `node scripts/generate-test-data.mjs` to generate fictional fixtures and copies in `outputs/test-data/`:

| File | Expected result |
| --- | --- |
| `legacy-test.csv` | 24 entries: 22 expenses totalling AUD 1,583.83 and 2 income entries totalling AUD 5,600.15. Includes quoted commas, quotes and a multiline note. |
| `recurring-test-v2.csv` | 10 active entries, 5 repeating series, AUD and USD, saved deletion progress and a stopped subscription. On 28 October 2026, reopening adds exactly 3 due entries; another reopening adds none. |
| `complete-test-backup.json` | The same 10 active entries plus 3 Bin records, categories and preferences. |

Executable tests cover transfer round trips, repeated imports, retained edits and stops, invalid final rows, malformed metadata, precise amounts, quota failures and recovery after an interrupted import. Browser checks also exercised imports, preview cancellation, due-entry generation, actual CSV/JSON downloads, and the pre-import backup with fictional data.
