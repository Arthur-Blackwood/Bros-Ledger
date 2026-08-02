# Bro's Ledger

Bro's Ledger is a private, responsive, local-first personal-finance ledger built with Next.js and vinext. Transactions, categories, preferences, and the income-privacy PIN stay in the current browser. It includes quick transaction entry, interactive reports, CSV import/export, installable PWA icons, and light/dark themes.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed in the terminal. Each browser profile starts with a new empty ledger and stores its own data locally.

## Verify a change

```bash
npm test
npm run lint
```

## Cloudflare deployment

No database or runtime secrets are required. In Cloudflare's Git integration, use:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

The free `workers.dev` deployment only serves the application files. Ledger data never leaves the user's browser. Clearing browser data removes the local ledger, so users should export CSV backups regularly.
