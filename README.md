# Bro’s Ledger

A private, local-first personal finance ledger. Every transaction, category and preference lives in your browser’s local storage — there is no account to create, no server-side database, and nothing to sign in to.

Built with Next.js 16 and React 19, bundled by Vite through [vinext](https://www.npmjs.com/package/vinext), and deployed as a Cloudflare Worker.

## Features

### Today

- Net cash flow for the current month, split into income and spending.
- A seven-day spending chart. Days with no spending render no bar at all, and any day with activity opens straight into its entries.
- Optional outlier filtering that caps the chart scale so a single unusual day does not flatten the rest of the week.
- A day-by-day transaction list with a copyable, auto-generated daily note.

### Reports

- **Spending by category** as a donut chart over a month, quarter or year, with an option to roll categories below 3% into *Other*.
- **Activity heat map** of the last 8, 16 or 26 weeks, showing expenditure and income for every day.
- **Explorer chart** that groups income or spending by day, month or year and reports the total, highest, lowest and average.
- Interquartile-range outlier filtering, available on each chart independently.
- Chart settings are remembered between visits.

### Transactions

- The full ledger grouped by date, with inline editing and deletion.
- CSV import and export using the columns `Date, Category, Note, Account, Amount`. Positive amounts are treated as income, negative amounts as expenses. Categories that do not exist yet are created on import.

### Personalization

- Light, dark, or follow-the-system themes.
- Five colour palettes: forest, ocean, indigo, plum and terracotta.
- Custom categories with emoji, reorderable by drag.

### Income privacy

Income is hidden by default and unlocked with a PIN you set the first time the app runs. The PIN itself is never stored — only a PBKDF2-SHA-256 hash (120,000 iterations) and a random salt, both kept locally. While income is hidden it is excluded from every total, chart and CSV export.

> Amounts are formatted as AUD using the `en-AU` locale.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the URL printed in the terminal. Each browser profile starts with an empty ledger and keeps its own data.

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
worker/          Cloudflare Worker entry point
wrangler.jsonc   Worker configuration
```

Almost all of the interface lives in `app/ledger-app.tsx`.

## Deploy to Cloudflare

No database, bindings or runtime secrets are required. Using Cloudflare’s Git integration:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

Or deploy by hand:

```bash
npm run build
npx wrangler deploy
```

The Worker only serves the application files. Ledger data never reaches it.

## Where your data lives

Everything is stored under `bros-ledger:*` keys in the browser’s local storage:

| Key | Contents |
| --- | --- |
| `bros-ledger:transactions:v1` | Every transaction |
| `bros-ledger:categories:v1` | Your categories and their order |
| `bros-ledger:privacy-pin-hash:v1` | PBKDF2 hash of the income PIN |
| `bros-ledger:privacy-pin-salt:v1` | Salt for that hash |
| `bros-ledger:theme:v1` | Theme preference |
| `bros-ledger:palette:v1` | Colour palette preference |
| `bros-ledger:week-outlier-filter:v1` | Seven-day chart outlier setting |
| `bros-ledger:report-chart-preferences:v1` | Saved report chart settings |

Clearing site data, browsing privately, or moving to another browser or device means starting from an empty ledger. **Export a CSV regularly** — it is the only backup.
