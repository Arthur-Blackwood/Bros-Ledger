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
  assert.match(app, /<BrandMark className="brand-mark" \/>/);
  assert.match(favicon, /prefers-color-scheme: dark/);
  assert.match(favicon, /class="face"/);
  assert.match(manifest, /favicon\.svg/);
});

test("ships the required install and social assets", async () => {
  await Promise.all([
    access(new URL("public/favicon.svg", root)),
    access(new URL("public/icon-192.png", root)),
    access(new URL("public/icon-512.png", root)),
    access(new URL("public/og.png", root)),
    access(new URL("public/apple-touch-icon.png", root)),
    access(new URL("public/icon-maskable-512.png", root)),
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
  for (const palette of ["mono", "forest", "ocean", "indigo", "plum", "terracotta"]) {
    assert.match(app, new RegExp(`"${palette}"`));
    assert.match(styles, new RegExp(`palette-${palette}`));
  }
  for (const palette of ["mono", "ocean", "indigo", "plum", "terracotta"]) assert.match(styles, new RegExp(`data-palette=\\"${palette}\\"`));
  assert.match(layout, /dataset\.palette/);
  assert.match(layout, /dataset\.palette="mono"/);
  assert.match(app, /typeof window === "undefined"\) return "mono"/);
  assert.match(app, /\? saved : "mono"/);
  for (const category of ["Shopping", "Health", "Subscription", "Electronics", "Dine", "Education", "Transport", "Fun", "Other", "Income", "Overseas"]) assert.match(app, new RegExp(`\\["${category}"`));
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

test("the seven-day chart saves outlier scaling and opens the matching ledger day", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(app, /bros-ledger:week-outlier-filter:v1/);
  assert.match(app, /activityScaleMaximum\(weekData\.map/);
  assert.match(app, /openTransactionsForDate/);
  assert.match(app, /focusDate=\{transactionFocusDate\}/);
  assert.match(app, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(app, /activity-income-pill/);
  assert.doesNotMatch(app, /activity-half income/);
  assert.match(styles, /\.week-filter-toggle\.active/);
  assert.match(styles, /\.ledger-day\.focused/);
  assert.match(styles, /@keyframes incomeRainbow/);
  assert.match(styles, /linear-gradient\(110deg, #ff5f6d/);
});

test("declares icons that survive an install to the home screen", async () => {
  const [layout, manifest, favicon] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/manifest.ts", root), "utf8"),
    readFile(new URL("public/favicon.svg", root), "utf8"),
  ]);

  // iOS ignores the web manifest entirely, so Safari needs its own declaration.
  assert.match(layout, /apple: \[\{ url: "\/apple-touch-icon\.png", sizes: "180x180", type: "image\/png" \}\]/);
  assert.match(layout, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(layout, /name="apple-mobile-web-app-title"/);
  // Android masks any icon that does not declare a maskable safe zone.
  assert.match(manifest, /src: "\/icon-maskable-512\.png", sizes: "512x512", type: "image\/png", purpose: "maskable"/);
  assert.match(favicon, /viewBox="0 0 512 512"/);
});

test("the activity heatmap only marks days that moved money", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  // A single-type view must not fall through to the view name, or every day in
  // the range renders as activity regardless of whether anything happened.
  assert.match(app, /const hasExpense = item\.expense > 0;/);
  assert.match(app, /const hasIncome = item\.income > 0;/);
  assert.doesNotMatch(app, /: "" : effectiveActivityView;/);
  assert.match(app, /effectiveActivityView === "expense" \? hasExpense \? "expense" : "" : hasIncome \? "income" : ""/);
  // Belt and braces: a zero-level pill must not paint even if one is rendered.
  assert.match(styles, /\.activity-income-pill\.level-0 \{ display: none; \}/);
});

test("deleting an entry parks it in the Bin instead of dropping it", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(app, /bros-ledger:deleted-transactions:v1/);
  assert.match(app, /const deletedRetentionDays = 30;/);
  // Deleting must capture the entry, not just filter it away.
  assert.match(app, /const target = transactions\.find\(\(item\) => item\.id === id\);/);
  assert.match(app, /deletedAt: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(app, /setNotice\("Transaction deleted\."\);/);
  // Restore and permanent delete both exist, and the bin respects the income lock.
  assert.match(app, /const restoreTransaction = async \(id: string\)/);
  assert.match(app, /const purgeTransaction = async \(id: string\)/);
  assert.match(app, /const purgeAllTransactions = async \(\)/);
  assert.match(app, /const visibleDeleted = useMemo\(\(\) => incomeHidden/);
  // Reachable from the sidebar and rendered by its own panel.
  assert.match(app, /label="Bin" onClick=\{\(\) => setView\("deleted"\)\}/);
  assert.match(app, /function BinPanel/);
  assert.match(app, /type View = "overview" \| "reports" \| "transactions" \| "deleted" \| "personalization";/);
  assert.match(styles, /\.deleted-row \{/);
  // The nav entry carries a drawn icon, sized against the neighbouring glyphs.
  assert.match(app, /function BinIcon\(\)/);
  assert.match(app, /icon=\{<BinIcon \/>\}/);
  assert.match(app, /icon: ReactNode/);
  assert.match(styles, /\.main-nav button span svg, \.mobile-nav button span svg/);
  // Settings uses a drawn gear on both navs; no pencil glyph anywhere.
  assert.match(app, /function GearIcon\(\)/);
  assert.strictEqual(app.match(/icon=\{<GearIcon \/>\}/g).length, 2);
  assert.doesNotMatch(app, /✎/);
});

test("mobile Settings carries the bin the sidebar shows on desktop", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  // The mobile tab is Settings now, and the desktop sidebar keeps its own entry.
  assert.match(app, /label="Settings" onClick=\{\(\) => setView\("personalization"\)\}/);
  assert.doesNotMatch(app, /label="Personalize"/);
  assert.doesNotMatch(app, /label="Personalization"/);
  // Both the sidebar and the mobile tab point at the same view.
  assert.strictEqual(app.match(/label="Settings"/g).length, 2);
  assert.match(app, /label="Bin" onClick=\{\(\) => setView\("deleted"\)\}/);
  // The bin is passed in as a slot and rendered after the category editor card.
  assert.match(app, /bin: ReactNode/);
  assert.match(app, /<div className="settings-deleted">\{bin\}<\/div>/);
  // Hidden by default, revealed only where the sidebar is gone.
  assert.match(styles, /\.settings-deleted \{ display: none; \}/);
  assert.match(styles, /\.sidebar \{ display: none; \}\.settings-deleted \{ display: block; \}/);
  assert.match(app, /className="personalize-shortcut"[\s\S]*?>Settings<\/button>/);
});

test("the currency is detected rather than hardcoded", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  // Nothing may pin the ledger to one country any more.
  assert.doesNotMatch(app, /"AUD"/);
  assert.doesNotMatch(app, /minimumFractionDigits: 2/);
  assert.match(app, /bros-ledger:currency:v1/);
  // Time zone first, UI language second: en-US in Sydney should still mean AUD.
  assert.match(app, /const detectCurrency = \(\)/);
  assert.match(app, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  assert.match(app, /zoneRegions \?\?= buildZoneRegions\(\)/);
  assert.match(app, /new Intl\.Locale\(navigator\.language\)\.maximize\(\)\.region/);
  // The picker and its labels come from Intl, not a bundled list.
  assert.match(app, /supportedValuesOf\?\.\("currency"\)/);
  assert.match(app, /new Intl\.DisplayNames\(undefined, \{ type: "currency" \}\)/);
  assert.match(styles, /\.currency-select \{/);
  // Detection must never reach the network.
  assert.doesNotMatch(app, /ipapi|ipinfo|geoip|https?:\/\//);
  // Entries keep the currency they were recorded in.
  assert.match(app, /money\(item\.amountCents, item\.currency\)/);
});

test("dates follow the reader locale and transactions are searchable", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  // No formatter may be pinned to one locale any more.
  assert.doesNotMatch(app, /"en-AU"/);
  assert.strictEqual(app.match(/new Intl\.DateTimeFormat\(undefined/g).length, 4);

  // Search keeps typing on the urgent render and defers the filtering.
  assert.match(app, /const deferredQuery = useDeferredValue\(query\)/);
  assert.match(app, /useDeferredValue, useEffect/);
  assert.match(app, /const visibleGroups = useMemo/);
  // Every term must match, so multi-word queries narrow rather than widen.
  assert.match(app, /terms\.every\(\(term\) => haystack\.includes\(term\)\)/);
  // The list, the count and the scroll-to-day effect all read the filtered set.
  assert.match(app, /\{visibleGroups\.map\(\(\[date, items\]\) => \{/);
  assert.match(app, /const transactionCount = visibleGroups\.reduce/);
  assert.match(app, /\}, \[focusDate, visibleGroups\]\);/);
  assert.doesNotMatch(app, /\{groups\.map\(\(\[date, items\]\) => \{/);
  // A search with no hits is distinguishable from an empty ledger.
  assert.match(app, /<h3>No matches<\/h3>/);
  assert.match(styles, /\.ledger-search-input \{/);
});

test("repeating transactions generate without drifting or resurrecting", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(app, /bros-ledger:repeat-marks:v1/);
  assert.match(app, /type RepeatRule = \{ every: number; unit: RepeatUnit \}/);
  // Optional on Transaction so ledgers written before this feature still parse.
  assert.match(app, /repeat\?: RepeatRule \| null;/);
  assert.match(app, /seriesId\?: string;/);

  // Occurrences are measured from the series anchor. Stepping from the previous
  // one makes a rule set on the 31st slip to the 28th and never recover.
  assert.match(app, /const occurrenceAfter = \(anchorKey: string, repeat: RepeatRule, n: number\)/);
  assert.match(app, /target\.setDate\(Math\.min\(day, lastDay\)\)/);
  // The high-water mark is what stops a deleted occurrence coming back.
  assert.match(app, /const cursor = mark && mark > latest\.occurredAt \? mark : latest\.occurredAt;/);
  // A backdated daily rule must not flood the ledger on first open.
  assert.match(app, /const maxGeneratedPerLoad = 400;/);
  assert.match(app, /guard < maxGeneratedPerLoad/);
  // Generated rows join the series and are tagged so they can be told apart.
  assert.match(app, /source: "repeat"/);

  // The control is offered on both add and edit, defaulting to no repeat.
  assert.match(app, /function RepeatField/);
  assert.strictEqual(app.match(/<RepeatField /g).length, 2);
  assert.match(app, /\{ id: "never", label: "Never", rule: null \}/);
  assert.match(app, /\{ id: "fortnightly", label: "Fortnightly", rule: \{ every: 2, unit: "week" \} \}/);
  assert.match(styles, /\.repeat-options button\.active \{/);
});

test("the recorded date is editable", async () => {
  const app = await readFile(new URL("app/ledger-app.tsx", root), "utf8");

  assert.match(app, /type TransactionChanges = \{ date: string;/);
  assert.match(app, /const \[date, setDate\] = useState\(transaction\.occurredAt\);/);
  assert.match(app, /onSave\(transaction\.id, \{ date, category/);
  assert.match(app, /occurredAt: changes\.date/);
  // Same validation and same future cap as the add drawer.
  assert.match(app, /Enter a valid date\./);
  assert.match(app, /<label className="field-label">Date<input type="date" value=\{date\} max=\{today\}/);
  assert.match(app, /today: string;/);
  // The drawer title tracks the edited value instead of the stored one.
  assert.match(app, /<p>\{longDate\(date\)\}<\/p>/);
});

test("the cash flow card slides between months", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.doesNotMatch(app, /Cash flow options/);
  assert.match(app, /const slideCashflow = \(amount: number\)/);
  // Sliding must never run past the current month.
  assert.match(app, /return next > toDateKey\(\)\.slice\(0, 7\) \? current : next;/);
  assert.match(app, /disabled=\{atCurrentMonth\}/);
  // Pointer swipe as well as the arrows.
  assert.match(app, /onPointerDown=\{\(event\) => \{ swipeFrom\.current = event\.clientX; \}\}/);
  assert.match(app, /Math\.abs\(delta\) > 45/);
  // The card has its own month, so sliding it does not move the selected day.
  assert.match(app, /const cashflowItems = useMemo/);
  assert.match(styles, /\.balance-nav \{/);
});

test("the activity heat map is laid out as monthly calendars", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("app/ledger-app.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.doesNotMatch(app, /activityWeeks/);
  assert.doesNotMatch(styles, /\.activity-grid/);
  assert.match(app, /type ActivitySpan = 1 \| 3 \| 6 \| 12;/);
  assert.match(app, /activitySpan: 1,/);
  assert.match(app, /const activityMonths = useMemo/);
  // Monday-first, and each month gets its own block with leading blanks.
  assert.match(app, /\(new Date\(year, month - 1, 1, 12\)\.getDay\(\) \+ 6\) % 7/);
  assert.match(app, /className="activity-blank"/);
  assert.match(app, /className="activity-month"/);
  // Averages across the span, plus a per-month total.
  assert.match(app, /const activityAverages = useMemo/);
  assert.match(app, /Average expenditure per month/);
  assert.match(styles, /\.activity-months \{/);

  // Single-day inspection must be untouched by the relayout.
  assert.match(app, /onClick=\{\(\) => setSelectedActivityDate\(\(current\) => current === item\.date \? null : item\.date\)\}/);
  assert.match(app, /aria-pressed=\{selectedActivityDate === item\.date\}/);
  assert.match(app, /selectedActivityDate && <ReportDetailPanel/);
  assert.match(app, /activity-income-pill level-\$\{incomeLevel\}/);
  assert.match(app, /const hasExpense = item\.expense > 0;/);
});
