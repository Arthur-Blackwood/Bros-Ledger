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

test("uses a neutral installed-app title bar", async () => {
  const [layout, manifest] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/manifest.ts", root), "utf8"),
  ]);
  assert.match(layout, /name="theme-color" content="#242629"/);
  assert.match(layout, /apple-mobile-web-app-status-bar-style/);
  assert.match(manifest, /theme_color: "#242629"/);
});

test("stores the ledger and privacy PIN on the current device", async () => {
  const [layout, app] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
  ]);

  assert.match(layout, /bros-ledger:theme:v1/);
  assert.match(layout, /daylight-ledger:theme:v1/);
  assert.match(app, /bros-ledger:report-chart-preferences:v1/);
  assert.match(app, /daylight-ledger:report-chart-preferences:v1/);
  assert.match(app, /bros-ledger:transactions:v1/);
  assert.match(app, /bros-ledger:categories:v1/);
  assert.match(app, /bros-ledger:privacy-pin-hash:v1/);
  assert.match(app, /bros-ledger:palette:v1/);
  assert.doesNotMatch(app, /fetch\("\/api\//);
});

test("ships coordinated light and dark colour palettes", async () => {
  const [layout, app, styles] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  for (const palette of ["forest", "ocean", "indigo", "plum", "terracotta"]) {
    assert.match(app, new RegExp(`"${palette}"`));
    assert.match(styles, new RegExp(`palette-${palette}`));
  }
  for (const palette of ["ocean", "indigo", "plum", "terracotta"]) assert.match(styles, new RegExp(`data-palette=\\"${palette}\\"`));
  assert.match(layout, /dataset\.palette/);
  assert.match(layout, /dataset\.palette="indigo"/);
  assert.match(app, /typeof window === "undefined"\) return "indigo"/);
  assert.match(app, /\? saved : "indigo"/);
  assert.match(styles, /--heat-empty:/);
  assert.match(styles, /--chart-6:/);
  assert.match(styles, /:root\[data-theme\]\[data-palette\]/);
  assert.match(styles, /--cream: var\(--app-bg\)/);
  assert.match(styles, /--mint-deep: var\(--accent\)/);
  assert.match(styles, /:root\[data-theme\]\[data-palette\] \.add-button/);
  assert.match(styles, /:root\[data-theme\]\[data-palette\] \.sidebar/);
  assert.match(styles, /\.privacy-locked-copy \{/);
  assert.match(styles, /\.category-picker button\.active/);
  assert.match(styles, /\.compact-toggle\.active, \.outlier-toggle\.active/);
});

test("deploys without a shared cloud database", async () => {
  const workerConfig = await readFile(new URL("wrangler.jsonc", root), "utf8");
  assert.match(workerConfig, /"name": "bros-ledger"/);
  assert.match(workerConfig, /"workers_dev": true/);
  assert.match(workerConfig, /"preview_urls": false/);
  assert.doesNotMatch(workerConfig, /d1_databases|"binding": "DB"/);
});

test("supports the existing Bro's Ledger CSV columns", async () => {
  const app = await readFile(new URL("app/ledger-app.tsx", root), "utf8");
  for (const column of ["Date", "Category", "Note", "Account", "Amount"]) assert.match(app, new RegExp(`"${column}"`));
  assert.match(app, /transactionsFromCsv/);
});
