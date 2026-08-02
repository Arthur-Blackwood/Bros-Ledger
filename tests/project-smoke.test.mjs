import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("uses the Bro's Ledger brand across install and page metadata", async () => {
  const [layout, page, manifest, app, favicon] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/manifest.ts", root), "utf8"),
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("public/favicon.svg", root), "utf8"),
  ]);

  for (const source of [layout, page, manifest, app, favicon]) {
    assert.match(source, /Bro(?:'|&apos;)s Ledger/);
  }
  assert.match(app, /className="brand-mark">B</);
  assert.match(favicon, />B<\/text>/);
});

test("ships the required install and social assets", async () => {
  await Promise.all([
    access(new URL("public/favicon.svg", root)),
    access(new URL("public/icon-192.png", root)),
    access(new URL("public/icon-512.png", root)),
    access(new URL("public/og.png", root)),
  ]);
});

test("keeps renamed browser preferences compatible with existing installations", async () => {
  const [layout, app, auth] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("app/ledger-auth.ts", root), "utf8"),
  ]);

  assert.match(layout, /bros-ledger:theme:v1/);
  assert.match(layout, /daylight-ledger:theme:v1/);
  assert.match(app, /bros-ledger:report-chart-preferences:v1/);
  assert.match(app, /daylight-ledger:report-chart-preferences:v1/);
  assert.match(auth, /bros_ledger_session/);
  assert.match(auth, /daylight_session/);
});

test("binds the Cloudflare Worker to the Bro's Ledger database", async () => {
  const workerConfig = await readFile(new URL("wrangler.jsonc", root), "utf8");
  assert.match(workerConfig, /"name": "bros-ledger"/);
  assert.match(workerConfig, /"binding": "DB"/);
  assert.match(workerConfig, /"database_name": "bros-ledger"/);
  assert.match(workerConfig, /"workers_dev": true/);
  assert.match(workerConfig, /"preview_urls": false/);
});
