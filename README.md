# Bro's Ledger

Bro's Ledger is a private, responsive personal-finance ledger built with Next.js, vinext, and Cloudflare D1. It includes quick transaction entry, category and account editing, interactive reports, CSV export, installable PWA icons, light/dark themes, and an owner-controlled income privacy mode.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed in the terminal. The local Cloudflare runtime stores its D1 data under `.wrangler/`, which is excluded from Git.

## Verify a change

```bash
npm test
npm run lint
```

## Cloudflare deployment

The production Worker needs:

- a D1 database bound as `DB`
- encrypted secrets named `OWNER_PIN`, `FAMILY_PIN`, and `SESSION_SECRET`
- Node.js compatibility enabled

`OWNER_PIN` and `FAMILY_PIN` must each be five digits. `SESSION_SECRET` should be a long random value and must never be committed to Git.

The repository already includes the production D1 binding in `wrangler.jsonc`. In Cloudflare's Git integration, use:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

After the first deployment, add `OWNER_PIN`, `FAMILY_PIN`, and `SESSION_SECRET` under the Worker's **Settings → Variables and Secrets** page. The application creates and upgrades its ledger tables on first use.
