"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

type Transaction = {
  id: string;
  occurredAt: string;
  type: "expense" | "income";
  amountCents: number;
  currency: string;
  category: string;
  account: string;
  note: string;
  tags: string[];
  source: string;
};
type TransactionDraft = { date: string; type: Transaction["type"]; amount: number; category: string; account: string; note: string };
type TransactionChanges = { category: string; note: string; account: string; amount: number };
type DeletedTransaction = Transaction & { deletedAt: string };

type CategoryType = "expense" | "income";
type LedgerCategory = { id: string; name: string; emoji: string; type: CategoryType };
type View = "overview" | "reports" | "transactions" | "deleted" | "personalization";
type ExplorerType = "expense" | "income";
type ExplorerGroup = "day" | "month" | "year";
type ExplorerPeriod = "week" | "month" | "quarter" | "year" | "all";
type CategoryPeriod = "month" | "quarter" | "year";
type ActivityView = "both" | "expense" | "income";
type ActivityWeeks = 8 | 16 | 26;
type ThemePreference = "system" | "light" | "dark";
type PalettePreference = "mono" | "forest" | "ocean" | "indigo" | "plum" | "terracotta";

const localTransactionsKey = "bros-ledger:transactions:v1";
const localCategoriesKey = "bros-ledger:categories:v1";
const privacyPinHashKey = "bros-ledger:privacy-pin-hash:v1";
const privacyPinSaltKey = "bros-ledger:privacy-pin-salt:v1";
const deletedTransactionsKey = "bros-ledger:deleted-transactions:v1";
const deletedRetentionDays = 30;

const starterCategoryTemplates: Array<[string, string, CategoryType]> = [
  ["Shopping", "🛍️", "expense"], ["Health", "💪", "expense"], ["Subscription", "🔔", "expense"],
  ["Electronics", "📱", "expense"], ["Dine", "🍜", "expense"], ["Education", "📖", "expense"],
  ["Transport", "🚆", "expense"], ["Fun", "🎬", "expense"], ["Other", "⭐", "expense"],
  ["Income", "💵", "income"], ["Overseas", "💸", "income"],
];

const saveLocalTransactions = (transactions: Transaction[]) => window.localStorage.setItem(localTransactionsKey, JSON.stringify(transactions));
const saveLocalCategories = (categories: LedgerCategory[]) => window.localStorage.setItem(localCategoriesKey, JSON.stringify(categories));
const saveDeletedTransactions = (items: DeletedTransaction[]) => window.localStorage.setItem(deletedTransactionsKey, JSON.stringify(items));

// Reading also prunes: anything past the retention window is dropped on load so the
// bin cannot grow without bound, and "recently" stays honest.
const readDeletedTransactions = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(deletedTransactionsKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - deletedRetentionDays * 86400000;
    return (parsed as DeletedTransaction[]).filter((item) => Number.isFinite(Date.parse(item.deletedAt)) && Date.parse(item.deletedAt) >= cutoff);
  } catch { return []; }
};

const readLocalTransactions = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(localTransactionsKey) ?? "[]");
    return Array.isArray(parsed) ? parsed as Transaction[] : [];
  } catch { return []; }
};

const readLocalCategories = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(localCategoriesKey) ?? "null");
    if (Array.isArray(parsed) && parsed.length) return parsed as LedgerCategory[];
  } catch { /* Create the starter set below. */ }
  const categories = starterCategoryTemplates.map(([name, emoji, type]) => ({ id: crypto.randomUUID(), name, emoji, type }));
  saveLocalCategories(categories);
  return categories;
};

const bytesToBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const bytesToHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const derivePrivacyPinHash = async (pin: string, salt: Uint8Array) => {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 120_000 }, material, 256);
  return bytesToHex(bits);
};

const createPrivacyPin = async (pin: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePrivacyPinHash(pin, salt);
  window.localStorage.setItem(privacyPinSaltKey, bytesToBase64(salt));
  window.localStorage.setItem(privacyPinHashKey, hash);
};

const verifyPrivacyPin = async (pin: string) => {
  const salt = window.localStorage.getItem(privacyPinSaltKey);
  const expected = window.localStorage.getItem(privacyPinHashKey);
  if (!salt || !expected) return false;
  return await derivePrivacyPinHash(pin, base64ToBytes(salt)) === expected;
};

const parseCsvRows = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((item) => item.some((value) => value.trim()));
};

const transactionsFromCsv = (text: string) => {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("The CSV file has no transactions.");
  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const required = ["date", "category", "note", "account", "amount"];
  const indexes = Object.fromEntries(required.map((name) => [name, headers.indexOf(name)])) as Record<string, number>;
  if (required.some((name) => indexes[name] < 0)) throw new Error("Use the Bro's Ledger CSV columns: Date, Category, Note, Account and Amount.");
  return rows.slice(1).map((row, rowIndex) => {
    const occurredAt = row[indexes.date]?.trim();
    const rawAmount = row[indexes.amount]?.trim().replace(/[A-Z$\s,]/gi, "").replace("−", "-");
    const amount = Number(rawAmount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredAt) || !Number.isFinite(amount) || amount === 0) throw new Error(`CSV row ${rowIndex + 2} has an invalid date or amount.`);
    const type: Transaction["type"] = amount > 0 ? "income" : "expense";
    return {
      id: crypto.randomUUID(), occurredAt, type, amountCents: Math.round(Math.abs(amount) * 100), currency: "AUD",
      category: row[indexes.category]?.trim() || (type === "income" ? "Income" : "Other"),
      note: row[indexes.note] ?? "", account: row[indexes.account]?.trim() || "Everyday", tags: [], source: "csv",
    } satisfies Transaction;
  });
};

const themePreferenceKey = "bros-ledger:theme:v1";
const legacyThemePreferenceKey = "daylight-ledger:theme:v1";
const palettePreferenceKey = "bros-ledger:palette:v1";
const weekOutlierFilterKey = "bros-ledger:week-outlier-filter:v1";

const readThemePreference = (): ThemePreference => {
  if (typeof window === "undefined") return "system";
  try {
    const saved = window.localStorage.getItem(themePreferenceKey) ?? window.localStorage.getItem(legacyThemePreferenceKey);
    if (saved) window.localStorage.setItem(themePreferenceKey, saved);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
};

const readPalettePreference = (): PalettePreference => {
  if (typeof window === "undefined") return "mono";
  try {
    const saved = window.localStorage.getItem(palettePreferenceKey);
    return saved === "mono" || saved === "forest" || saved === "ocean" || saved === "indigo" || saved === "plum" || saved === "terracotta" ? saved : "mono";
  } catch {
    return "forest";
  }
};

type ReportChartPreferences = {
  explorerType: ExplorerType;
  explorerGroup: ExplorerGroup;
  explorerPeriod: ExplorerPeriod;
  filterOutliers: boolean;
  categoryPeriod: CategoryPeriod;
  categoryFilterOutliers: boolean;
  groupSmallCategories: boolean;
  activityView: ActivityView;
  activityWeeks: ActivityWeeks;
  activityFilterOutliers: boolean;
};

const reportChartPreferencesKey = "bros-ledger:report-chart-preferences:v1";
const legacyReportChartPreferencesKey = "daylight-ledger:report-chart-preferences:v1";
const defaultReportChartPreferences: ReportChartPreferences = {
  explorerType: "expense",
  explorerGroup: "day",
  explorerPeriod: "all",
  filterOutliers: false,
  categoryPeriod: "month",
  categoryFilterOutliers: false,
  groupSmallCategories: true,
  activityView: "both",
  activityWeeks: 16,
  activityFilterOutliers: false,
};

const readReportChartPreferences = (): ReportChartPreferences => {
  if (typeof window === "undefined") return defaultReportChartPreferences;
  try {
    const stored = window.localStorage.getItem(reportChartPreferencesKey) ?? window.localStorage.getItem(legacyReportChartPreferencesKey);
    if (stored) window.localStorage.setItem(reportChartPreferencesKey, stored);
    const value = JSON.parse(stored ?? "{}") as Partial<ReportChartPreferences>;
    return {
      explorerType: value.explorerType === "income" ? "income" : "expense",
      explorerGroup: value.explorerGroup === "month" || value.explorerGroup === "year" ? value.explorerGroup : "day",
      explorerPeriod: value.explorerPeriod === "week" || value.explorerPeriod === "month" || value.explorerPeriod === "quarter" || value.explorerPeriod === "year" ? value.explorerPeriod : "all",
      filterOutliers: Boolean(value.filterOutliers),
      categoryPeriod: value.categoryPeriod === "quarter" || value.categoryPeriod === "year" ? value.categoryPeriod : "month",
      categoryFilterOutliers: Boolean(value.categoryFilterOutliers),
      groupSmallCategories: typeof value.groupSmallCategories === "boolean" ? value.groupSmallCategories : true,
      activityView: value.activityView === "expense" || value.activityView === "income" ? value.activityView : "both",
      activityWeeks: value.activityWeeks === 8 || value.activityWeeks === 26 ? value.activityWeeks : 16,
      activityFilterOutliers: Boolean(value.activityFilterOutliers),
    };
  } catch {
    return defaultReportChartPreferences;
  }
};

const categoryMeta: Record<string, { emoji: string; color: string }> = {
  Food: { emoji: "🍜", color: "#c96745" },
  Transport: { emoji: "🚆", color: "#5f99aa" },
  Shopping: { emoji: "🛍️", color: "#efc94c" },
  Home: { emoji: "🏠", color: "#8ba9a0" },
  Fun: { emoji: "🎬", color: "#b89082" },
  Health: { emoji: "💪", color: "#6f9b79" },
  Subscription: { emoji: "🔔", color: "#b89082" },
  Electronics: { emoji: "📱", color: "#5f99aa" },
  Dine: { emoji: "🍜", color: "#c96745" },
  Education: { emoji: "📖", color: "#8ba9a0" },
  Income: { emoji: "💵", color: "#2f6f62" },
  Overseas: { emoji: "💸", color: "#6f9b79" },
  Other: { emoji: "⭐", color: "#a8aea8" },
};

const donutPalette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
const donutColor = (index: number) => donutPalette[index] ?? `hsl(${(index * 137.508) % 360} 46% 53%)`;

const toDateKey = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const dateShift = (dateKey: string, amount: number) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
};

const money = (cents: number, currency = "AUD", signed = false) => {
  const value = cents / 100;
  const text = new Intl.NumberFormat("en-AU", { style: "currency", currency, minimumFractionDigits: 2 }).format(Math.abs(value));
  if (!signed || cents === 0) return text;
  return `${cents > 0 ? "+" : "−"}${text}`;
};

const displayNote = (note: string, fallback = "No note") => note.split(/\r?\n/, 1)[0].trim() || fallback;

const longDate = (dateKey: string) => new Intl.DateTimeFormat("en-AU", {
  month: "long", day: "numeric", weekday: "short",
}).format(new Date(`${dateKey}T12:00:00`));

const explorerKey = (dateKey: string, group: ExplorerGroup) => group === "day" ? dateKey : group === "month" ? dateKey.slice(0, 7) : dateKey.slice(0, 4);

const explorerLabel = (key: string, group: ExplorerGroup) => {
  if (group === "year") return key;
  if (group === "month") return new Intl.DateTimeFormat("en-AU", { month: "short", year: "2-digit" }).format(new Date(`${key}-01T12:00:00`));
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(new Date(`${key}T12:00:00`));
};

const quartile = (values: number[], ratio: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[lower + 1] !== undefined ? fraction * (sorted[lower + 1] - sorted[lower]) : 0);
};

const activityScaleMaximum = (values: number[], filterOutliers: boolean) => {
  const positive = values.filter((value) => value > 0);
  const maximum = positive.length ? Math.max(...positive) : 1;
  if (!filterOutliers || positive.length < 4) return maximum;
  const q1 = quartile(positive, .25);
  const q3 = quartile(positive, .75);
  return Math.max(1, Math.min(maximum, q3 + 1.5 * (q3 - q1)));
};

const activityLevel = (value: number, maximum: number) => value === 0 ? 0 : value <= maximum * .25 ? 1 : value <= maximum * .5 ? 2 : value <= maximum * .75 ? 3 : 4;

export function LedgerApp() {
  const today = useMemo(() => toDateKey(), []);
  const [pinReady, setPinReady] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("overview");
  const [selectedDate, setSelectedDate] = useState(today);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [deletedTransactions, setDeletedTransactions] = useState<DeletedTransaction[]>([]);
  const [categories, setCategories] = useState<LedgerCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [notice, setNotice] = useState("");
  const [incomeHidden, setIncomeHidden] = useState(true);
  const [privacyUnlockOpen, setPrivacyUnlockOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const [palettePreference, setPalettePreference] = useState<PalettePreference>(readPalettePreference);
  const [weekFilterOutliers, setWeekFilterOutliers] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(weekOutlierFilterKey) === "true");
  const [transactionFocusDate, setTransactionFocusDate] = useState<string | null>(null);

  useEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = themePreference === "system" ? systemTheme.matches ? "dark" : "light" : themePreference;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themePreference = themePreference;
    };
    applyTheme();
    systemTheme.addEventListener("change", applyTheme);
    return () => systemTheme.removeEventListener("change", applyTheme);
  }, [themePreference]);

  useEffect(() => {
    document.documentElement.dataset.palette = palettePreference;
  }, [palettePreference]);

  const updateThemePreference = (preference: ThemePreference) => {
    setThemePreference(preference);
    try { window.localStorage.setItem(themePreferenceKey, preference); } catch { /* Keep the theme for this visit. */ }
  };

  const updatePalettePreference = (preference: PalettePreference) => {
    setPalettePreference(preference);
    try { window.localStorage.setItem(palettePreferenceKey, preference); } catch { /* Keep the palette for this visit. */ }
  };

  useEffect(() => {
    setTransactions(readLocalTransactions());
    const pruned = readDeletedTransactions();
    setDeletedTransactions(pruned);
    saveDeletedTransactions(pruned);
    setCategories(readLocalCategories());
    setPinReady(Boolean(window.localStorage.getItem(privacyPinHashKey) && window.localStorage.getItem(privacyPinSaltKey)));
    setLoading(false);
  }, []);

  const visibleTransactions = useMemo(() => incomeHidden ? transactions.filter((item) => item.type === "expense") : transactions, [transactions, incomeHidden]);
  // The bin honours the income lock too, so hidden income cannot leak out through it.
  const visibleDeleted = useMemo(() => incomeHidden ? deletedTransactions.filter((item) => item.type === "expense") : deletedTransactions, [deletedTransactions, incomeHidden]);
  const categoryEmoji = (name: string) => categories.find((category) => category.name === name)?.emoji ?? categoryMeta[name]?.emoji ?? "✨";
  const currency = visibleTransactions[0]?.currency ?? "AUD";
  const selectedItems = visibleTransactions.filter((item) => item.occurredAt === selectedDate);
  const selectedExpense = selectedItems.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amountCents, 0);
  const selectedIncome = selectedItems.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amountCents, 0);
  const monthKey = selectedDate.slice(0, 7);
  const monthItems = visibleTransactions.filter((item) => item.occurredAt.startsWith(monthKey));
  const monthExpense = monthItems.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amountCents, 0);
  const monthIncome = monthItems.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amountCents, 0);

  const categoryTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    monthItems.filter((item) => item.type === "expense").forEach((item) => { totals[item.category] = (totals[item.category] || 0) + item.amountCents; });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [monthItems]);

  const weekData = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = dateShift(selectedDate, index - 6);
    const items = visibleTransactions.filter((item) => item.occurredAt === date && item.type === "expense");
    return { date, value: items.reduce((sum, item) => sum + item.amountCents, 0), count: items.length };
  }), [selectedDate, visibleTransactions]);
  const weekScaleMaximum = activityScaleMaximum(weekData.map((item) => item.value), weekFilterOutliers);
  const weekTotal = weekData.reduce((sum, item) => sum + item.value, 0);

  const toggleWeekOutlierFilter = () => {
    setWeekFilterOutliers((current) => {
      const next = !current;
      window.localStorage.setItem(weekOutlierFilterKey, String(next));
      return next;
    });
  };

  const openTransactionsForDate = (date: string) => {
    setSelectedDate(date);
    setTransactionFocusDate(date);
    setView("transactions");
  };

  const reportGroups = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    visibleTransactions.forEach((item) => {
      const group = groups.get(item.occurredAt) ?? [];
      group.push(item);
      groups.set(item.occurredAt, group);
    });
    return Array.from(groups.entries()).sort(([dateA], [dateB]) => dateB.localeCompare(dateA));
  }, [visibleTransactions]);

  const dailySummary = incomeHidden
    ? `${longDate(selectedDate)}: spent ${money(selectedExpense, currency)}. ${selectedItems.length ? `${selectedItems.length} expense${selectedItems.length === 1 ? "" : "s"}${categoryTotals[0] ? `, with ${categoryTotals[0][0]} leading this month` : " recorded"}.` : "No expenses recorded for this day."}`
    : `${longDate(selectedDate)}: spent ${money(selectedExpense, currency)}, received ${money(selectedIncome, currency)}, net ${money(selectedIncome - selectedExpense, currency, true)}. ${selectedItems.length ? `${selectedItems.length} transaction${selectedItems.length === 1 ? "" : "s"}${categoryTotals[0] ? `, with ${categoryTotals[0][0]} leading this month` : " recorded"}.` : "No transactions recorded for this day."}`;

  const copyText = async (text: string, message: string) => {
    await navigator.clipboard.writeText(text);
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const exportCsv = () => {
    const escapeCsv = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = visibleTransactions.map((item) => [
      item.occurredAt,
      item.category,
      item.note,
      item.account,
      ((item.type === "income" ? 1 : -1) * item.amountCents / 100).toFixed(2),
    ]);
    const csv = [["Date", "Category", "Note", "Account", "Amount"], ...rows]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = incomeHidden ? `bros-ledger-expenses-only-${today}.csv` : `bros-ledger-${today}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    const exported = visibleTransactions.length;
    const withheld = transactions.length - exported;
    setNotice(withheld
      ? `${exported} expense${exported === 1 ? "" : "s"} exported. ${withheld} income ${withheld === 1 ? "entry is" : "entries are"} withheld while income is hidden \u2014 unlock income to include ${withheld === 1 ? "it" : "them"}.`
      : `${exported} transaction${exported === 1 ? "" : "s"} exported.`);
  };

  const importCsv = async (file: File) => {
    const imported = transactionsFromCsv(await file.text());
    const nextTransactions = [...imported, ...transactions];
    saveLocalTransactions(nextTransactions);
    setTransactions(nextTransactions);
    const nextCategories = [...categories];
    imported.forEach((item) => {
      if (!nextCategories.some((category) => category.name.toLowerCase() === item.category.toLowerCase())) {
        nextCategories.push({ id: crypto.randomUUID(), name: item.category, emoji: "✨", type: item.type });
      }
    });
    saveLocalCategories(nextCategories);
    setCategories(nextCategories);
    setNotice(`${imported.length} transaction${imported.length === 1 ? "" : "s"} imported from CSV.`);
  };

  const addTransaction = async (draft: TransactionDraft) => {
    if (!Number.isFinite(draft.amount) || draft.amount <= 0) throw new Error("Enter an amount greater than zero.");
    const transaction: Transaction = {
      id: crypto.randomUUID(), occurredAt: draft.date, type: draft.type, amountCents: Math.round(draft.amount * 100),
      currency: "AUD", category: draft.category, account: draft.account.trim() || "Everyday", note: draft.note, tags: [], source: "manual",
    };
    const next = [transaction, ...transactions];
    saveLocalTransactions(next);
    setTransactions(next);
  };

  const updateTransaction = async (id: string, changes: TransactionChanges) => {
    if (!Number.isFinite(changes.amount) || changes.amount <= 0) throw new Error("Enter an amount greater than zero.");
    const next = transactions.map((item) => item.id === id ? { ...item, category: changes.category.trim(), note: changes.note, account: changes.account.trim() || "Everyday", amountCents: Math.round(changes.amount * 100) } : item);
    saveLocalTransactions(next);
    setTransactions(next);
  };

  const hideIncome = () => {
    setIncomeHidden(true);
    setPrivacyUnlockOpen(false);
    setDrawerOpen(false);
    if (editingTransaction?.type === "income") setEditingTransaction(null);
    setNotice("Income is hidden.");
  };

  const showIncome = () => {
    setIncomeHidden(false);
    setPrivacyUnlockOpen(false);
    setNotice("Income is visible for this visit.");
  };

  const removeTransaction = async (id: string) => {
    const target = transactions.find((item) => item.id === id);
    const next = transactions.filter((item) => item.id !== id);
    saveLocalTransactions(next);
    setTransactions(next);
    if (target) {
      const nextDeleted = [{ ...target, deletedAt: new Date().toISOString() }, ...deletedTransactions];
      saveDeletedTransactions(nextDeleted);
      setDeletedTransactions(nextDeleted);
    }
    setNotice(`Moved to Recently Deleted. Kept for ${deletedRetentionDays} days.`);
  };

  const restoreTransaction = async (id: string) => {
    const target = deletedTransactions.find((item) => item.id === id);
    if (!target) return;
    const restored: Transaction = {
      id: target.id, occurredAt: target.occurredAt, type: target.type, amountCents: target.amountCents,
      currency: target.currency, category: target.category, account: target.account, note: target.note,
      tags: target.tags, source: target.source,
    };
    const nextDeleted = deletedTransactions.filter((item) => item.id !== id);
    const next = [restored, ...transactions];
    saveDeletedTransactions(nextDeleted);
    setDeletedTransactions(nextDeleted);
    saveLocalTransactions(next);
    setTransactions(next);
    setNotice("Entry restored to your ledger.");
  };

  const purgeTransaction = async (id: string) => {
    const nextDeleted = deletedTransactions.filter((item) => item.id !== id);
    saveDeletedTransactions(nextDeleted);
    setDeletedTransactions(nextDeleted);
    setNotice("Entry deleted permanently.");
  };

  const purgeAllTransactions = async () => {
    // Only clears what the current privacy mode can actually see.
    const removable = new Set(visibleDeleted.map((item) => item.id));
    const nextDeleted = deletedTransactions.filter((item) => !removable.has(item.id));
    saveDeletedTransactions(nextDeleted);
    setDeletedTransactions(nextDeleted);
    setNotice(`${removable.size} ${removable.size === 1 ? "entry" : "entries"} deleted permanently.`);
  };

  const saveCategoryOrder = async (ordered: LedgerCategory[]) => {
    saveLocalCategories(ordered);
    setCategories(ordered);
  };

  const saveCategory = async (draft: Omit<LedgerCategory, "id">, editing: LedgerCategory | null) => {
    if (!draft.name.trim()) throw new Error("Category name is required.");
    if (categories.some((item) => item.id !== editing?.id && item.name.toLowerCase() === draft.name.trim().toLowerCase())) throw new Error("That category already exists.");
    const nextCategories = editing
      ? categories.map((item) => item.id === editing.id ? { ...item, ...draft, name: draft.name.trim() } : item)
      : [...categories, { id: crypto.randomUUID(), ...draft, name: draft.name.trim() }];
    if (editing && editing.name !== draft.name.trim()) {
      const nextTransactions = transactions.map((item) => item.category === editing.name ? { ...item, category: draft.name.trim() } : item);
      saveLocalTransactions(nextTransactions);
      setTransactions(nextTransactions);
    }
    saveLocalCategories(nextCategories);
    setCategories(nextCategories);
  };

  const removeCategory = async (id: string) => {
    const next = categories.filter((item) => item.id !== id);
    saveLocalCategories(next);
    setCategories(next);
  };

  if (pinReady === null) return <AuthLoading />;
  if (!pinReady) return <PrivacyPinSetup onCreated={() => setPinReady(true)} />;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("overview")} aria-label="Go to overview">
          <BrandMark className="brand-mark" /><span>Bro&apos;s Ledger</span>
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          <NavItem active={view === "overview"} icon="⌂" label="Today" onClick={() => setView("overview")} />
          <NavItem active={view === "reports"} icon="↗" label="Reports" onClick={() => setView("reports")} />
          <NavItem active={view === "transactions"} icon="≡" label="Transactions" onClick={() => { setTransactionFocusDate(null); setView("transactions"); }} />
          <NavItem active={view === "deleted"} icon="⌫" label="Recently Deleted" onClick={() => setView("deleted")} />
            <NavItem active={view === "personalization"} icon="✎" label="Personalization" onClick={() => setView("personalization")} />
        </nav>
        <div className="sidebar-foot">
          <div className="sync-dot"><span /> Saved on this device</div>
          <p>Private to this browser</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{view === "overview" ? "Today under southern skies" : view === "reports" ? "Spending insights" : view === "transactions" ? "Detailed ledger" : view === "deleted" ? "Recoverable entries" : "Make it yours"}</p>
            <h1>{view === "overview" ? "Money, in a clearer light." : view === "reports" ? "Where did the money go?" : view === "transactions" ? "Every entry, in one place." : view === "deleted" ? `Deleted in the last ${deletedRetentionDays} days.` : "Your quickest categories."}</h1>
          </div>
          <div className="topbar-actions"><span className="access-badge owner">Local only</span><button type="button" className={`privacy-toggle ${incomeHidden ? "hidden" : "shown"}`} onClick={() => incomeHidden ? setPrivacyUnlockOpen(true) : hideIncome()} aria-pressed={!incomeHidden}><span aria-hidden="true">{incomeHidden ? "◉" : "◎"}</span>{incomeHidden ? "Income hidden" : "Income shown"}</button>{view === "reports" && <button className="personalize-shortcut" onClick={() => setView("personalization")}>Personalize</button>}<button className="add-button" onClick={() => setDrawerOpen(true)}><span>＋</span> Add transaction</button></div>
        </header>

        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {view === "overview" && (
          <div className="dashboard-grid">
            <section className="balance-card">
              <div className="balance-head"><span>Net cash flow</span><button aria-label="Cash flow options">•••</button></div>
              <strong aria-label={incomeHidden ? "Income treated as zero" : undefined}>{money((incomeHidden ? 0 : monthIncome) - monthExpense, currency, true)}</strong>
              <div className="balance-meta">
                <div><span className="legend-dot income" />Income this month <b>{money(incomeHidden ? 0 : monthIncome, currency)}</b></div>
                <div><span className="legend-dot expense" />Spent this month <b>{money(monthExpense, currency)}</b></div>
              </div>
              <div className="balance-art" aria-hidden="true"><i /><i /><i /></div>
            </section>

            <section className="week-card">
              <div className="section-heading week-heading"><div><p>Last 7 days</p><h2>{money(weekTotal, currency)}</h2></div><div className="week-heading-actions"><span>Daily avg. {money(Math.round(weekTotal / 7), currency)}</span><button type="button" className={`week-filter-toggle ${weekFilterOutliers ? "active" : ""}`} onClick={toggleWeekOutlierFilter} aria-pressed={weekFilterOutliers}><i aria-hidden="true" />Filter outliers</button></div></div>
              <div className="mini-bars" aria-label="Spending over the last seven days">
                {weekData.map((item) => {
                  const isClippedOutlier = weekFilterOutliers && item.value > weekScaleMaximum;
                  return <button type="button" className="mini-bar" key={item.date} disabled={!item.count} onClick={() => openTransactionsForDate(item.date)} aria-label={item.count ? `${longDate(item.date)}: ${money(item.value, currency)} spent across ${item.count} ${item.count === 1 ? "transaction" : "transactions"}. Open in Transactions.` : `${longDate(item.date)}: no expense transactions.`}>{item.value > 0 && <i style={{ height: `${Math.max(12, Math.min(item.value, weekScaleMaximum) / weekScaleMaximum * 100)}%` }} className={`${item.date === selectedDate ? "current" : ""} ${isClippedOutlier ? "clipped-outlier" : ""}`}><b aria-hidden="true">{isClippedOutlier ? "···" : ""}</b></i>}<span>{new Intl.DateTimeFormat("en-AU", { weekday: "narrow" }).format(new Date(`${item.date}T12:00:00`))}</span></button>;
                })}
              </div>
            </section>

            <section className="transactions-card">
              <div className="date-switcher">
                <button onClick={() => setSelectedDate(dateShift(selectedDate, -1))} aria-label="Previous day">‹</button>
                <div><h2>{selectedDate === today ? "Today" : longDate(selectedDate)}</h2><p>{selectedDate} · {selectedItems.length} {selectedItems.length === 1 ? "entry" : "entries"}</p></div>
                <button onClick={() => setSelectedDate(dateShift(selectedDate, 1))} aria-label="Next day" disabled={selectedDate >= today}>›</button>
              </div>
              <div className="day-total"><span>Net for the day</span><strong>{money((incomeHidden ? 0 : selectedIncome) - selectedExpense, currency, true)}</strong></div>
              <div className="transaction-list">
                {loading ? <div className="empty-state">Opening your ledger…</div> : selectedItems.length ? selectedItems.map((item) => (
                  <article className="transaction" key={item.id}>
                  <button type="button" className="transaction-open" onClick={() => setEditingTransaction(item)} aria-label={`Edit ${displayNote(item.note, "entry")}, ${item.category}, ${money(item.amountCents, item.currency)}`} />
                    <div className="category-icon" style={{ background: `${categoryMeta[item.category]?.color ?? categoryMeta.Other.color}30` }}>{categoryEmoji(item.category)}</div>
                    <div className="transaction-copy"><h3>{displayNote(item.note, "Untitled entry")}</h3><p>{item.category} · {item.account}</p></div>
                    <div className={`transaction-amount ${item.type}`}><strong>{item.type === "income" ? "+" : "−"}{money(item.amountCents, item.currency)}</strong></div>
                    <button className="delete-button" onClick={() => removeTransaction(item.id)} aria-label={`Delete ${item.note || "entry"}`}>×</button>
                  </article>
                )) : <div className="empty-state"><span>🌿</span><h3>A quiet day so far</h3><p>Add the first entry when you are ready.</p><button onClick={() => setDrawerOpen(true)}>Add transaction</button></div>}
              </div>
            </section>

            <section className="daily-note-card">
              <div className="note-top"><span className="spark">✦</span><p>Daily note</p><button onClick={() => copyText(dailySummary, "Daily note copied.")}>Copy</button></div>
              <h2>{selectedExpense ? `You spent ${money(selectedExpense, currency)}` : "No spending yet"}</h2>
              <p>{dailySummary}</p>
              <div className="note-tags"><span>Auto-generated</span><span>{selectedItems.length} transaction{selectedItems.length === 1 ? "" : "s"}</span></div>
            </section>
          </div>
        )}

        {view === "reports" && (
          <ReportsPanel transactions={visibleTransactions} selectedDate={selectedDate} currency={currency} categoryEmoji={categoryEmoji} incomeHidden={incomeHidden} onShowTransactions={() => { setTransactionFocusDate(null); setView("transactions"); }} onEditTransaction={(transaction) => { setTransactionFocusDate(null); setView("transactions"); setEditingTransaction(transaction); }} />
        )}

        {view === "transactions" && <TransactionsPanel groups={reportGroups} focusDate={transactionFocusDate} currency={currency} categoryEmoji={categoryEmoji} onEdit={setEditingTransaction} onExport={exportCsv} onImport={importCsv} onAdd={() => setDrawerOpen(true)} />}

        {view === "deleted" && <RecentlyDeletedPanel items={visibleDeleted} categoryEmoji={categoryEmoji} retentionDays={deletedRetentionDays} onRestore={restoreTransaction} onPurge={purgeTransaction} onPurgeAll={purgeAllTransactions} />}

        {view === "personalization" && <PersonalizationPanel key={incomeHidden ? "income-hidden" : "income-shown"} categories={categories} incomeHidden={incomeHidden} themePreference={themePreference} palettePreference={palettePreference} onThemeChange={updateThemePreference} onPaletteChange={updatePalettePreference} onReorder={saveCategoryOrder} onSave={saveCategory} onRemove={removeCategory} />}

      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavItem active={view === "overview"} icon="⌂" label="Today" onClick={() => setView("overview")} />
        <NavItem active={view === "reports"} icon="↗" label="Reports" onClick={() => setView("reports")} />
        <button className="mobile-add" onClick={() => setDrawerOpen(true)} aria-label="Add transaction">＋</button>
        <NavItem active={view === "transactions"} icon="≡" label="Transactions" onClick={() => { setTransactionFocusDate(null); setView("transactions"); }} />
        <NavItem active={view === "personalization"} icon="✎" label="Personalize" onClick={() => setView("personalization")} />
      </nav>

      {drawerOpen && <TransactionDrawer today={today} categories={categories} incomeHidden={incomeHidden} onClose={() => setDrawerOpen(false)} onSave={addTransaction} onSaved={() => { setDrawerOpen(false); setNotice("Transaction saved on this device."); }} />}
      {editingTransaction && <EditTransactionDrawer transaction={editingTransaction} categories={categories} incomeHidden={incomeHidden} onClose={() => setEditingTransaction(null)} onSave={updateTransaction} onDelete={removeTransaction} onSaved={() => { setEditingTransaction(null); setNotice("Entry updated on this device."); }} onDeleted={() => { setEditingTransaction(null); setNotice("Entry deleted."); }} />}
      {privacyUnlockOpen && <IncomePrivacyUnlock onClose={() => setPrivacyUnlockOpen(false)} onUnlocked={showIncome} />}
    </main>
  );
}

function ReportsPanel({ transactions, selectedDate, currency, categoryEmoji, incomeHidden, onShowTransactions, onEditTransaction }: {
  transactions: Transaction[];
  selectedDate: string;
  currency: string;
  categoryEmoji: (name: string) => string;
  incomeHidden: boolean;
  onShowTransactions: () => void;
  onEditTransaction: (transaction: Transaction) => void;
}) {
  const [explorerType, setExplorerType] = useState<ExplorerType>("expense");
  const [explorerGroup, setExplorerGroup] = useState<ExplorerGroup>("day");
  const [explorerPeriod, setExplorerPeriod] = useState<ExplorerPeriod>("all");
  const [filterOutliers, setFilterOutliers] = useState(false);
  const [categoryPeriod, setCategoryPeriod] = useState<CategoryPeriod>("month");
  const [categoryFilterOutliers, setCategoryFilterOutliers] = useState(false);
  const [groupSmallCategories, setGroupSmallCategories] = useState(true);
  const [activityView, setActivityView] = useState<ActivityView>("both");
  const [activityWeeks, setActivityWeeks] = useState<ActivityWeeks>(16);
  const [activityFilterOutliers, setActivityFilterOutliers] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [selectedActivityDate, setSelectedActivityDate] = useState<string | null>(null);
  const [selectedExplorerKey, setSelectedExplorerKey] = useState<string | null>(null);
  const [openInfo, setOpenInfo] = useState<"activity" | "outliers" | null>(null);
  const [chartPreferencesReady, setChartPreferencesReady] = useState(false);
  const effectiveExplorerType: ExplorerType = incomeHidden ? "expense" : explorerType;
  const effectiveActivityView: ActivityView = incomeHidden ? "expense" : activityView;

  useEffect(() => {
    const saved = readReportChartPreferences();
    setExplorerType(saved.explorerType);
    setExplorerGroup(saved.explorerGroup);
    setExplorerPeriod(saved.explorerPeriod);
    setFilterOutliers(saved.filterOutliers);
    setCategoryPeriod(saved.categoryPeriod);
    setCategoryFilterOutliers(saved.categoryFilterOutliers);
    setGroupSmallCategories(saved.groupSmallCategories);
    setActivityView(saved.activityView);
    setActivityWeeks(saved.activityWeeks);
    setActivityFilterOutliers(saved.activityFilterOutliers);
    setChartPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!chartPreferencesReady) return;
    try {
      window.localStorage.setItem(reportChartPreferencesKey, JSON.stringify({
        explorerType,
        explorerGroup,
        explorerPeriod,
        filterOutliers,
        categoryPeriod,
        categoryFilterOutliers,
        groupSmallCategories,
        activityView,
        activityWeeks,
        activityFilterOutliers,
      } satisfies ReportChartPreferences));
    } catch {
      // Preferences remain usable for the current visit when browser storage is unavailable.
    }
  }, [chartPreferencesReady, explorerType, explorerGroup, explorerPeriod, filterOutliers, categoryPeriod, categoryFilterOutliers, groupSmallCategories, activityView, activityWeeks, activityFilterOutliers]);

  const categoryPeriodMeta = useMemo(() => {
    const end = selectedDate;
    const anchor = new Date(`${selectedDate}T12:00:00`);
    const startDate = categoryPeriod === "month"
      ? new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12)
      : categoryPeriod === "quarter"
        ? new Date(anchor.getFullYear(), anchor.getMonth() - 2, 1, 12)
        : new Date(anchor.getFullYear(), 0, 1, 12);
    return {
      start: toDateKey(startDate),
      end,
      label: categoryPeriod === "month" ? "This month" : categoryPeriod === "quarter" ? "Last 3 months" : "This year",
    };
  }, [categoryPeriod, selectedDate]);

  const categorySourceTransactions = useMemo(() => transactions.filter((item) => item.type === "expense" && item.occurredAt >= categoryPeriodMeta.start && item.occurredAt <= categoryPeriodMeta.end), [transactions, categoryPeriodMeta]);
  const categoryTransactions = useMemo(() => {
    if (!categoryFilterOutliers || categorySourceTransactions.length < 4) return categorySourceTransactions;
    const values = categorySourceTransactions.map((item) => item.amountCents);
    const q1 = quartile(values, .25);
    const q3 = quartile(values, .75);
    const spread = q3 - q1;
    const lower = Math.max(0, q1 - 1.5 * spread);
    const upper = q3 + 1.5 * spread;
    return categorySourceTransactions.filter((item) => item.amountCents >= lower && item.amountCents <= upper);
  }, [categorySourceTransactions, categoryFilterOutliers]);

  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    categoryTransactions.forEach((item) => totals.set(item.category, (totals.get(item.category) ?? 0) + item.amountCents));
    const sorted = Array.from(totals.entries()).sort((left, right) => right[1] - left[1]);
    const total = sorted.reduce((sum, [, value]) => sum + value, 0);
    const visible: [string, number][] = [];
    let otherTotal = 0;

    sorted.forEach(([name, value], index) => {
      const isSmall = groupSmallCategories && total > 0 && value / total < .03;
      const exceedsChartLimit = index >= 5;
      if (isSmall || exceedsChartLimit) otherTotal += value;
      else visible.push([name, value]);
    });

    if (otherTotal) {
      const existingOther = visible.find((entry) => entry[0] === "Other");
      if (existingOther) existingOther[1] += otherTotal;
      else visible.push(["Other", otherTotal]);
    }
    return visible.sort((left, right) => right[1] - left[1]);
  }, [categoryTransactions, groupSmallCategories]);
  const categoryTotal = categoryTotals.reduce((sum, [, value]) => sum + value, 0);
  const excludedCategoryTransactions = categorySourceTransactions.length - categoryTransactions.length;

  const activity = useMemo(() => {
    const daily = new Map<string, { expense: number; income: number }>();
    transactions.forEach((item) => {
      const totals = daily.get(item.occurredAt) ?? { expense: 0, income: 0 };
      totals[item.type] += item.amountCents;
      daily.set(item.occurredAt, totals);
    });
    const days = activityWeeks * 7;
    return Array.from({ length: days }, (_, index) => {
      const date = dateShift(selectedDate, index - days + 1);
      return { date, ...(daily.get(date) ?? { expense: 0, income: 0 }) };
    });
  }, [transactions, selectedDate, activityWeeks]);
  const expenseActivityMax = activityScaleMaximum(activity.map((item) => item.expense), activityFilterOutliers);
  const incomeActivityMax = activityScaleMaximum(activity.map((item) => item.income), activityFilterOutliers);

  const explorerPeriodMeta = useMemo(() => {
    if (explorerPeriod === "all") return { start: null, end: selectedDate, label: "All time" };
    const anchor = new Date(`${selectedDate}T12:00:00`);
    const startDate = explorerPeriod === "week"
      ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - 6, 12)
      : explorerPeriod === "month"
        ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - 29, 12)
        : explorerPeriod === "quarter"
          ? new Date(anchor.getFullYear(), anchor.getMonth() - 2, anchor.getDate(), 12)
          : new Date(anchor.getFullYear(), 0, 1, 12);
    return {
      start: toDateKey(startDate),
      end: selectedDate,
      label: explorerPeriod === "week" ? "Last 7 days" : explorerPeriod === "month" ? "Last 30 days" : explorerPeriod === "quarter" ? "Last 3 months" : "This year",
    };
  }, [explorerPeriod, selectedDate]);

  const explorerSourceTransactions = useMemo(() => transactions.filter((item) => item.type === effectiveExplorerType && item.occurredAt <= explorerPeriodMeta.end && (!explorerPeriodMeta.start || item.occurredAt >= explorerPeriodMeta.start)), [transactions, effectiveExplorerType, explorerPeriodMeta]);

  const rawSeries = useMemo(() => {
    const grouped = new Map<string, number>();
    explorerSourceTransactions.forEach((item) => {
      const key = explorerKey(item.occurredAt, explorerGroup);
      grouped.set(key, (grouped.get(key) ?? 0) + item.amountCents);
    });
    return Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({ key, value }));
  }, [explorerSourceTransactions, explorerGroup]);

  const series = useMemo(() => {
    if (!filterOutliers || rawSeries.length < 4) return rawSeries;
    const values = rawSeries.map((item) => item.value);
    const q1 = quartile(values, .25);
    const q3 = quartile(values, .75);
    const spread = q3 - q1;
    const lower = Math.max(0, q1 - 1.5 * spread);
    const upper = q3 + 1.5 * spread;
    return rawSeries.filter((item) => item.value >= lower && item.value <= upper);
  }, [rawSeries, filterOutliers]);

  const explorerValues = series.map((item) => item.value);
  const explorerTotal = explorerValues.reduce((sum, value) => sum + value, 0);
  const explorerHighest = explorerValues.length ? Math.max(...explorerValues) : 0;
  const explorerLowest = explorerValues.length ? Math.min(...explorerValues) : 0;
  const explorerAverage = explorerValues.length ? Math.round(explorerTotal / explorerValues.length) : 0;
  const chartMax = Math.max(explorerHighest, 1);
  const tickIndexes = Array.from(new Set([0, Math.floor((series.length - 1) / 3), Math.floor((series.length - 1) * 2 / 3), series.length - 1])).filter((index) => index >= 0);
  const activityDetails = selectedActivityDate ? transactions.filter((item) => item.occurredAt === selectedActivityDate && (effectiveActivityView === "both" || item.type === effectiveActivityView)) : [];
  const explorerDetails = selectedExplorerKey ? explorerSourceTransactions.filter((item) => explorerKey(item.occurredAt, explorerGroup) === selectedExplorerKey) : [];

  const shareExplorer = async () => {
    const text = `${effectiveExplorerType === "expense" ? "Expenditure" : "Income"} total for ${explorerPeriodMeta.label.toLowerCase()}: ${money(explorerTotal, currency)}. Highest ${money(explorerHighest, currency)}, lowest ${money(explorerLowest, currency)}, average ${money(explorerAverage, currency)}.`;
    if (navigator.share) await navigator.share({ title: "Bro's Ledger report", text });
    else await navigator.clipboard.writeText(text);
    setShareStatus(navigator.share ? "Shared" : "Copied");
    window.setTimeout(() => setShareStatus(""), 1800);
  };

  return <div className="reports-grid">
    <section className="category-controls-card">
      <div className="section-heading"><div><p>Chart controls</p><h2>Category view</h2></div><button type="button" className="category-reset" onClick={() => { setCategoryPeriod("month"); setCategoryFilterOutliers(false); setGroupSmallCategories(true); }}>Reset</button></div>
      <div className="category-controls">
        <div className="category-period-control"><span>Period</span><div className="segmented-control category-period-options">{(["month", "quarter", "year"] as CategoryPeriod[]).map((period) => <button type="button" key={period} className={categoryPeriod === period ? "active" : ""} onClick={() => setCategoryPeriod(period)}>{period === "month" ? "Month" : period === "quarter" ? "3 months" : "Year"}</button>)}</div></div>
        <div className="category-control-row"><div><strong>Filter outliers</strong><span>Exclude unusually large or small transactions</span></div><button type="button" className={`compact-toggle ${categoryFilterOutliers ? "active" : ""}`} onClick={() => setCategoryFilterOutliers((value) => !value)} aria-pressed={categoryFilterOutliers}>{categoryFilterOutliers ? "On" : "Off"}</button></div>
        <div className="category-control-row"><div><strong>Group small categories</strong><span>Combine categories below 3% into Other</span></div><button type="button" className={`compact-toggle ${groupSmallCategories ? "active" : ""}`} onClick={() => setGroupSmallCategories((value) => !value)} aria-pressed={groupSmallCategories}>{groupSmallCategories ? "On" : "Off"}</button></div>
      </div>
      <div className="category-control-summary"><div><span>{categoryPeriodMeta.label}</span><strong>{money(categoryTotal, currency)}</strong></div><div><span>Transactions included</span><strong>{categoryTransactions.length}</strong></div>{categoryFilterOutliers && <div><span>Outliers excluded</span><strong>{excludedCategoryTransactions}</strong></div>}</div>
    </section>
    <section className="category-card">
      <div className="section-heading"><div><p>{categoryPeriodMeta.label}</p><h2>Spending by category</h2></div><span>{categoryTotals.length} categories shown</span></div>
      <div className="category-visual">
        <div className="donut" style={{ background: buildDonut(categoryTotals) }}><div><strong>{categoryTotals[0]?.[0] ?? "None yet"}</strong><span>Top spend</span></div></div>
        <div className="category-list">{categoryTotals.length ? categoryTotals.map(([name, value], index) => <div key={name}><span className="category-swatch" style={{ background: donutColor(index) }} /> <b>{categoryEmoji(name)} {name}</b><span>{money(value, currency)} · {categoryTotal ? Math.round(value / categoryTotal * 100) : 0}%</span></div>) : <p>No spending matches these chart settings.</p>}</div>
      </div>
    </section>

    <section className="activity-card analysis-card">
      <div className="analysis-heading"><div><p>Last {activityWeeks} weeks</p><h2>{effectiveActivityView === "both" ? "Cash flow activity" : effectiveActivityView === "expense" ? "Expenditure activity" : "Income activity"}</h2></div><button className="help-button" onClick={() => setOpenInfo((current) => current === "activity" ? null : "activity")} aria-label="About cash flow activity" aria-expanded={openInfo === "activity"} aria-controls="activity-info">?</button></div>
      {openInfo === "activity" && <InfoCallout id="activity-info">Each square is one calendar day. Expenditure fills the day cell, while income appears as a smaller animated rainbow capsule in the centre, so both flows stay readable at a glance. Empty days stay neutral. Outlier filtering caps the colour scale so unusual days do not flatten the rest of the chart. Exact transactions remain unchanged and available when you click a date.</InfoCallout>}
      <div className="activity-controls">
        <div><span>Display</span><div className="segmented-control group-control">{(["both", "expense", "income"] as ActivityView[]).map((view) => <button type="button" key={view} disabled={incomeHidden && view !== "expense"} className={effectiveActivityView === view ? "active" : ""} onClick={() => { setActivityView(view); setSelectedActivityDate(null); }}>{view === "both" ? "Both" : view === "expense" ? "Expense" : "Income"}</button>)}</div></div>
        <div><span>Period</span><div className="segmented-control group-control">{([8, 16, 26] as ActivityWeeks[]).map((weeks) => <button type="button" key={weeks} className={activityWeeks === weeks ? "active" : ""} onClick={() => { setActivityWeeks(weeks); setSelectedActivityDate(null); }}>{weeks} weeks</button>)}</div></div>
        <div><span>Filter outliers</span><button type="button" className={`outlier-toggle ${activityFilterOutliers ? "active" : ""}`} onClick={() => setActivityFilterOutliers((value) => !value)} aria-pressed={activityFilterOutliers}>{activityFilterOutliers ? "Filtering" : "Include all"}</button></div>
      </div>
      <div className="activity-grid" style={{ gridTemplateColumns: `repeat(${activityWeeks}, minmax(7px, 1fr))` }} aria-label={`Daily ${effectiveActivityView === "both" ? "income and expenditure" : effectiveActivityView} over the last ${activityWeeks} weeks`}>
        {activity.map((item) => {
          const expenseLevel = activityLevel(item.expense, expenseActivityMax);
          const incomeLevel = activityLevel(item.income, incomeActivityMax);
          const hasExpense = item.expense > 0;
          const hasIncome = item.income > 0;
          const hasBoth = effectiveActivityView === "both" && hasExpense && hasIncome;
          // A cell may only claim a type when that type actually moved money that day.
          // Falling through to effectiveActivityView marked every single day as activity.
          const singleType = effectiveActivityView === "both" ? hasExpense ? "expense" : hasIncome ? "income" : "" : effectiveActivityView === "expense" ? hasExpense ? "expense" : "" : hasIncome ? "income" : "";
          const singleLevel = singleType === "expense" ? expenseLevel : singleType === "income" ? incomeLevel : 0;
          const cellClass = hasBoth ? `expense level-${expenseLevel} has-income` : singleType === "expense" ? `expense level-${singleLevel}` : singleType === "income" ? "income-only" : "";
          const description = effectiveActivityView === "expense"
            ? `${longDate(item.date)}: expenditure ${money(item.expense, currency)}`
            : effectiveActivityView === "income"
              ? `${longDate(item.date)}: income ${money(item.income, currency)}`
              : `${longDate(item.date)}: expenditure ${money(item.expense, currency)}, income ${money(item.income, currency)}, net ${money(item.income - item.expense, currency, true)}`;
          return <button key={item.date} type="button" className={`activity-cell ${cellClass} ${selectedActivityDate === item.date ? "selected" : ""}`} title={description} aria-label={`Show activity for ${description}`} aria-pressed={selectedActivityDate === item.date} onClick={() => setSelectedActivityDate((current) => current === item.date ? null : item.date)}>{(hasBoth || singleType === "income") && <i className={`activity-income-pill level-${incomeLevel}`} aria-hidden="true" />}</button>;
        })}
      </div>
      <div className="activity-legend">{effectiveActivityView !== "income" && <span><i className="expense level-3" />Expense · scale to {money(expenseActivityMax, currency)}</span>}{effectiveActivityView !== "expense" && <span><i className="income level-3" />Income · scale to {money(incomeActivityMax, currency)}</span>}<span><i className="level-0" />No activity</span><small>Darker colour means a larger daily total.</small></div>
      {selectedActivityDate && <ReportDetailPanel title={longDate(selectedActivityDate)} subtitle={effectiveActivityView === "both" ? "Cash flow activity" : effectiveActivityView === "expense" ? "Expenditure activity" : "Income activity"} items={activityDetails} currency={currency} categoryEmoji={categoryEmoji} onEdit={onEditTransaction} onClose={() => setSelectedActivityDate(null)} />}
    </section>

    <section className="explorer-card analysis-card">
      <div className="explorer-head"><div><p>Transactions explorer</p><h2>{money(explorerTotal, currency)}</h2><span>{explorerPeriodMeta.label} · {series.length} {explorerGroup === "day" ? "days" : explorerGroup === "month" ? "months" : "years"} included</span></div><button className="share-report" onClick={shareExplorer} aria-label="Share report summary">{shareStatus || "↗"}</button></div>
      {series.length ? <>
        <div className={`trend-chart ${effectiveExplorerType}`} aria-label={`${effectiveExplorerType} grouped by ${explorerGroup}`}>
          <div className="trend-y-labels"><span>{money(chartMax, currency)}</span><span>{money(chartMax / 2, currency)}</span><span>{money(0, currency)}</span></div>
          <div className="trend-bars">{series.map((item) => <button type="button" className={`trend-bar-wrap ${selectedExplorerKey === item.key ? "selected" : ""}`} key={item.key} title={`${explorerLabel(item.key, explorerGroup)}: ${money(item.value, currency)}`} aria-label={`Show ${effectiveExplorerType} details for ${explorerLabel(item.key, explorerGroup)}: ${money(item.value, currency)}`} aria-pressed={selectedExplorerKey === item.key} onClick={() => setSelectedExplorerKey((current) => current === item.key ? null : item.key)}><i style={{ height: `${Math.max(3, item.value / chartMax * 100)}%` }} /></button>)}</div>
          <div className="trend-x-labels">{tickIndexes.map((index) => <span key={series[index].key}>{explorerLabel(series[index].key, explorerGroup)}</span>)}</div>
        </div>
        {selectedExplorerKey && series.some((item) => item.key === selectedExplorerKey) && <ReportDetailPanel title={explorerLabel(selectedExplorerKey, explorerGroup)} subtitle={effectiveExplorerType === "expense" ? "Expenditure" : "Income"} items={explorerDetails} currency={currency} categoryEmoji={categoryEmoji} onEdit={onEditTransaction} onClose={() => setSelectedExplorerKey(null)} />}
        <div className="explorer-stats"><div><span>Highest</span><strong>{money(explorerHighest, currency)}</strong></div><div><span>Lowest</span><strong>{money(explorerLowest, currency)}</strong></div><div><span>Amplitude</span><strong>{money(explorerHighest - explorerLowest, currency)}</strong></div><div><span>Average</span><strong>{money(explorerAverage, currency)}</strong></div></div>
      </> : <div className="explorer-empty">No {effectiveExplorerType} data for this selection.</div>}
      <div className="explorer-controls">
        <div><span>Period</span><div className="segmented-control period-control">{(["week", "month", "quarter", "year", "all"] as ExplorerPeriod[]).map((period) => <button key={period} className={explorerPeriod === period ? "active" : ""} onClick={() => { setExplorerPeriod(period); setSelectedExplorerKey(null); }}>{period === "week" ? "7 days" : period === "month" ? "30 days" : period === "quarter" ? "3 months" : period === "year" ? "Year" : "All"}</button>)}</div></div>
        <div><span>Transaction type</span><div className="segmented-control"><button className={effectiveExplorerType === "expense" ? "active" : ""} onClick={() => { setExplorerType("expense"); setSelectedExplorerKey(null); }}>Expenditure</button><button disabled={incomeHidden} className={effectiveExplorerType === "income" ? "active" : ""} onClick={() => { setExplorerType("income"); setSelectedExplorerKey(null); }}>Income</button></div></div>
        <div><span>Group by</span><div className="segmented-control group-control">{(["day", "month", "year"] as ExplorerGroup[]).map((group) => <button key={group} className={explorerGroup === group ? "active" : ""} onClick={() => { setExplorerGroup(group); setSelectedExplorerKey(null); }}>{group[0].toUpperCase() + group.slice(1)}</button>)}</div></div>
        <div><span>Filter outliers <button className="help-inline" onClick={() => setOpenInfo((current) => current === "outliers" ? null : "outliers")} aria-label="About outlier filtering" aria-expanded={openInfo === "outliers"} aria-controls="outlier-info">?</button></span><button className={`outlier-toggle ${filterOutliers ? "active" : ""}`} onClick={() => { setFilterOutliers((value) => !value); setSelectedExplorerKey(null); }} aria-pressed={filterOutliers}>{filterOutliers ? "Filtering" : "Include all"}</button></div>
      </div>
      {openInfo === "outliers" && <InfoCallout id="outlier-info">When enabled, the chart and summary exclude unusually large or small grouped totals using the standard 1.5× interquartile-range rule. Your underlying transactions are never changed or deleted.</InfoCallout>}
      <button className="show-transactions" onClick={onShowTransactions}><span>Show all transactions</span><b>{transactions.length}</b></button>
    </section>
  </div>;
}

function ReportDetailPanel({ title, subtitle, items, currency, categoryEmoji, onEdit, onClose }: { title: string; subtitle: string; items: Transaction[]; currency: string; categoryEmoji: (name: string) => string; onEdit: (transaction: Transaction) => void; onClose: () => void }) {
  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 680px)");
    const previousOverflow = document.body.style.overflow;
    const syncPageScroll = () => {
      document.body.style.overflow = mobileQuery.matches ? "hidden" : previousOverflow;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    syncPageScroll();
    mobileQuery.addEventListener("change", syncPageScroll);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      mobileQuery.removeEventListener("change", syncPageScroll);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const editItem = (item: Transaction) => {
    onClose();
    onEdit(item);
  };

  return <div className="report-detail-layer">
    <button className="report-detail-backdrop" type="button" onClick={onClose} aria-label="Close transaction details" />
    <section className="report-detail" aria-live="polite" aria-label={`${subtitle} details for ${title}`}>
      <div className="report-detail-head"><div><p>{subtitle}</p><h3>{title}</h3></div><span>{items.length} {items.length === 1 ? "transaction" : "transactions"}</span><button type="button" onClick={onClose} aria-label="Close transaction details">×</button></div>
      {items.length ? <div className="report-detail-table">
        <div className="report-detail-columns"><span>Date</span><span>Category</span><span>Note</span><span>Account</span><span>Amount</span><span aria-hidden="true" /></div>
        {items.map((item) => <div className="report-detail-row" key={item.id}><time dateTime={item.occurredAt}>{item.occurredAt}</time><span className="report-detail-category"><small className="report-detail-mobile-label">Category</small><i aria-hidden="true">{categoryEmoji(item.category)}</i><span>{item.category}</span></span><strong>{displayNote(item.note)}</strong><span className="report-detail-account"><small className="report-detail-mobile-label">Account</small><span>{item.account}</span></span><b className={item.type}>{item.type === "income" ? "+" : "−"}{money(item.amountCents, item.currency || currency)}</b><button className="report-detail-edit" type="button" onClick={() => editItem(item)} aria-label={`Edit ${displayNote(item.note)}`}>Edit</button></div>)}
      </div> : <p className="report-detail-empty">No expenditure was recorded for this date.</p>}
    </section>
  </div>;
}

function InfoCallout({ id, children }: { id: string; children: ReactNode }) {
  return <aside className="info-callout" id={id} role="note"><span>i</span><p>{children}</p></aside>;
}

function TransactionsPanel({ groups, focusDate, currency, categoryEmoji, onEdit, onExport, onImport, onAdd }: {
  groups: [string, Transaction[]][];
  focusDate: string | null;
  currency: string;
  categoryEmoji: (name: string) => string;
  onEdit: (transaction: Transaction) => void;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
  onAdd: () => void;
}) {
  const transactionCount = groups.reduce((sum, [, items]) => sum + items.length, 0);
  const csvInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  useEffect(() => {
    if (!focusDate) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(`ledger-day-${focusDate}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusDate, groups]);
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true); setImportError("");
    try { await onImport(file); }
    catch (error) { setImportError(error instanceof Error ? error.message : "Could not import this CSV file."); }
    finally { setImporting(false); if (csvInput.current) csvInput.current.value = ""; }
  };
  return <div className="transactions-page">
    <section className="report-table-card entry-ledger-card">
      <div className="ledger-toolbar">
        <div><p>Detailed ledger</p><h2>All entries</h2><span>{transactionCount} transactions · Category, note, account and amount</span></div>
        <div className="csv-actions"><input ref={csvInput} type="file" accept=".csv,text/csv" onChange={(event) => void importFile(event.target.files?.[0])} /><button className="csv-button" onClick={() => csvInput.current?.click()} disabled={importing}>{importing ? "Importing…" : "⇧ Import CSV"}</button><button className="csv-button" onClick={onExport} disabled={!transactionCount}>⇩ Export CSV</button></div>
      </div>
      {importError && <p className="csv-error" role="alert">{importError}</p>}
      {groups.length ? <div className="ledger-table-scroll"><div className="entry-ledger">
        <div className="ledger-column-head"><span>Category</span><span>Note</span><span>Account</span><span>Amount</span><span aria-hidden="true" /></div>
        {groups.map(([date, items]) => {
          const dayNet = items.reduce((sum, item) => sum + (item.type === "income" ? item.amountCents : -item.amountCents), 0);
          return <section className={`ledger-day ${focusDate === date ? "focused" : ""}`} id={`ledger-day-${date}`} key={date}>
            <div className="ledger-day-head"><strong>{longDate(date)}</strong><span>{items.length} {items.length === 1 ? "entry" : "entries"}</span><b>{money(dayNet, items[0]?.currency ?? currency, true)}</b></div>
            {items.map((item) => <button className="ledger-entry-row" key={item.id} onClick={() => onEdit(item)} aria-label={`Edit ${displayNote(item.note)}, ${item.account}`}>
              <span className="ledger-category"><i style={{ background: `${categoryMeta[item.category]?.color ?? categoryMeta.Other.color}30` }}>{categoryEmoji(item.category)}</i><b>{item.category}</b></span>
              <span className="ledger-note">{displayNote(item.note)}</span>
              <span className="ledger-account">{item.account}</span>
              <strong className={item.type}>{item.type === "income" ? "+" : "−"}{money(item.amountCents, item.currency)}</strong>
              <span className="ledger-edit">Edit</span>
            </button>)}
          </section>;
        })}
      </div></div> : <div className="ledger-empty"><span>🌿</span><h3>No entries yet</h3><p>Add a transaction and it will appear here.</p><button onClick={onAdd}>Add transaction</button></div>}
    </section>
  </div>;
}

function AuthLoading() {
  return <main className="auth-shell"><div className="auth-card auth-loading"><BrandMark className="auth-mark" /><p>Opening your local ledger…</p></div></main>;
}

function PrivacyPinSetup({ onCreated }: { onCreated: () => void }) {
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError("");
    try {
      if (pin !== confirmation) throw new Error("The two PINs do not match.");
      await createPrivacyPin(pin);
      onCreated();
    } catch (setupError) { setError(setupError instanceof Error ? setupError.message : "Could not create the privacy PIN."); }
    finally { setSubmitting(false); }
  };

  return <main className="auth-shell">
    <section className="auth-card">
      <BrandMark className="auth-mark" />
      <p className="eyebrow">Bro&apos;s Ledger</p>
      <h1>Your own ledger,<br />on this device.</h1>
      <p className="auth-copy">Create a five-digit privacy PIN. It only unlocks income visibility; your new ledger starts empty and stays in this browser.</p>
      <form onSubmit={submit}>
        <label>Privacy PIN<input autoFocus type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{5}" maxLength={5} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="•••••" aria-describedby={error ? "pin-error" : undefined} required /></label>
        <label>Confirm PIN<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{5}" maxLength={5} value={confirmation} onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="•••••" required /></label>
        {error && <p className="auth-error" id="pin-error" role="alert">{error}</p>}
        <button disabled={submitting || pin.length !== 5 || confirmation.length !== 5}>{submitting ? "Creating…" : "Create local ledger"}</button>
      </form>
      <div className="auth-assurance"><span>●</span><p><b>Local by design</b><br />Clearing this browser&apos;s site data removes the ledger, so export CSV backups regularly.</p></div>
    </section>
  </main>;
}

function IncomePrivacyUnlock({ onClose, onUnlocked }: { onClose: () => void; onUnlocked: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError("");
    try {
      if (!await verifyPrivacyPin(pin)) throw new Error("That PIN is not correct.");
      setPin("");
      onUnlocked();
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "Could not reveal income.");
    } finally { setSubmitting(false); }
  };

  return <div className="privacy-layer" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
    <button type="button" className="privacy-backdrop" onClick={onClose} aria-label="Keep income hidden" />
    <section className="privacy-card">
      <button type="button" className="privacy-close" onClick={onClose} aria-label="Close">×</button>
      <div className="privacy-icon" aria-hidden="true">◎</div>
      <p className="eyebrow">Income privacy</p>
      <h2 id="privacy-title">Reveal income for this visit?</h2>
      <p>Enter this device&apos;s privacy PIN. Income will be hidden again when you refresh or close the app.</p>
      <form onSubmit={submit}>
        <label>Privacy PIN<input autoFocus type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{5}" maxLength={5} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="•••••" aria-describedby={error ? "privacy-pin-error" : undefined} required /></label>
        {error && <p className="auth-error" id="privacy-pin-error" role="alert">{error}</p>}
        <button disabled={submitting || pin.length !== 5}>{submitting ? "Checking…" : "Reveal income"}</button>
      </form>
      <button type="button" className="privacy-cancel" onClick={onClose}>Keep hidden</button>
    </section>
  </div>;
}

function PersonalizationPanel({ categories, incomeHidden, themePreference, palettePreference, onThemeChange, onPaletteChange, onReorder, onSave, onRemove }: { categories: LedgerCategory[]; incomeHidden: boolean; themePreference: ThemePreference; palettePreference: PalettePreference; onThemeChange: (preference: ThemePreference) => void; onPaletteChange: (preference: PalettePreference) => void; onReorder: (categories: LedgerCategory[]) => Promise<void>; onSave: (draft: Omit<LedgerCategory, "id">, editing: LedgerCategory | null) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const [editing, setEditing] = useState<LedgerCategory | null>(null);
  const [orderedCategories, setOrderedCategories] = useState(categories);
  const orderedCategoriesRef = useRef(categories);
  const draggingCategoryRef = useRef<string | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [draggingCategory, setDraggingCategory] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("✨");
  const [categoryType, setCategoryType] = useState<CategoryType>("expense");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    orderedCategoriesRef.current = categories;
    setOrderedCategories(categories);
  }, [categories]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const placeCategory = (sourceId: string, targetType: CategoryType, targetIndex: number) => {
    const current = orderedCategoriesRef.current;
    const source = current.find((category) => category.id === sourceId);
    if (!source) return current;
    const expense = current.filter((category) => category.type === "expense" && category.id !== sourceId);
    const income = current.filter((category) => category.type === "income" && category.id !== sourceId);
    const destination = targetType === "expense" ? expense : income;
    destination.splice(Math.max(0, Math.min(targetIndex, destination.length)), 0, { ...source, type: targetType });
    const next = [...expense, ...income];
    if (next.every((category, index) => category.id === current[index]?.id && category.type === current[index]?.type)) return current;
    orderedCategoriesRef.current = next;
    setOrderedCategories(next);
    return next;
  };

  const saveCategoryOrder = async (ordered = orderedCategoriesRef.current) => {
    setSavingOrder(true); setError("");
    try {
      await onReorder(ordered);
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : "Could not save the category order.");
    } finally { setSavingOrder(false); }
  };

  const updateCategoryDrag = (sourceId: string, clientX: number, clientY: number) => {
    const hit = document.elementFromPoint(clientX, clientY);
    const zone = hit?.closest<HTMLElement>("[data-category-type]");
    const targetType = zone?.dataset.categoryType as CategoryType | undefined;
    if (!zone || (targetType !== "expense" && targetType !== "income")) return;
    const targets = Array.from(zone.querySelectorAll<HTMLElement>("[data-category-id]")).filter((item) => item.dataset.categoryId !== sourceId);
    const targetIndex = targets.findIndex((item) => clientY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2);
    placeCategory(sourceId, targetType, targetIndex < 0 ? targets.length : targetIndex);
  };

  const startCategoryDrag = (event: ReactPointerEvent<HTMLButtonElement>, categoryId: string) => {
    if (savingOrder) return;
    event.preventDefault();
    dragCleanupRef.current?.();
    draggingCategoryRef.current = categoryId;
    setDraggingCategory(categoryId);
    const pointerId = event.pointerId;
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      updateCategoryDrag(categoryId, pointerEvent.clientX, pointerEvent.clientY);
    };
    const finish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      draggingCategoryRef.current = null;
      setDraggingCategory(null);
      void saveCategoryOrder();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const moveCategoryWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, categoryId: string) => {
    if (savingOrder) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowLeft" && event.key !== "ArrowDown" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = orderedCategoriesRef.current;
    const source = current.find((category) => category.id === categoryId);
    if (!source) return;
    const group = current.filter((category) => category.type === source.type);
    const index = group.findIndex((category) => category.id === categoryId);
    let next = current;
    if (event.key === "ArrowUp" && index > 0) next = placeCategory(categoryId, source.type, index - 1);
    if (event.key === "ArrowDown" && index < group.length - 1) next = placeCategory(categoryId, source.type, index + 1);
    if (event.key === "ArrowLeft" && source.type === "income") next = placeCategory(categoryId, "expense", current.filter((category) => category.type === "expense").length);
    if (event.key === "ArrowRight" && source.type === "expense") next = placeCategory(categoryId, "income", current.filter((category) => category.type === "income").length);
    if (next !== current) void saveCategoryOrder(next);
  };

  const beginEdit = (category: LedgerCategory) => {
    setEditing(category); setName(category.name); setEmoji(category.emoji); setCategoryType(category.type); setError("");
  };

  const beginAdd = () => {
    setEditing(null); setName(""); setEmoji("✨"); setCategoryType("expense"); setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await onSave({ name, emoji, type: categoryType }, editing);
      beginAdd();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save the category."); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!editing || !window.confirm(`Remove ${editing.name} from quick selection? Existing ledger entries will not be deleted.`)) return;
    setSaving(true); setError("");
    try {
      await onRemove(editing.id);
      beginAdd();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Could not remove the category."); }
    finally { setSaving(false); }
  };

  const renderCategorySection = (type: CategoryType, title: string, description: string) => {
    const group = orderedCategories.filter((category) => category.type === type);
    if (incomeHidden && type === "income") return <section className="category-group privacy-locked-section">
      <div className="category-group-heading"><div><strong>{title}</strong><span>{description}</span></div><em aria-label="Income category count hidden">—</em></div>
      <div className="privacy-locked-copy"><span aria-hidden="true">◉</span><div><strong>Income categories hidden</strong><p>Use the Income hidden control above to reveal them.</p></div></div>
    </section>;
    return <section className="category-group">
      <div className="category-group-heading"><div><strong>{title}</strong><span>{description}</span></div><em>{group.length}</em></div>
      <div className="category-drop-zone" data-category-type={type}>
        {group.map((category) => <div key={category.id} data-category-id={category.id} className={`category-library-item ${editing?.id === category.id ? "active" : ""} ${draggingCategory === category.id ? "dragging" : ""}`}><button type="button" className="category-edit-button" onClick={() => beginEdit(category)}><span>{category.emoji}</span><b>{category.name}</b><em>Edit</em></button><button type="button" className="category-drag-handle" aria-label={`Drag ${category.name} to reorder or move it between Expense and Income. Use arrow keys for the same actions.`} onPointerDown={(event) => startCategoryDrag(event, category.id)} onKeyDown={(event) => moveCategoryWithKeyboard(event, category.id)}>⠿</button></div>)}
        {!group.length && <div className="category-drop-empty">Drag categories here</div>}
      </div>
    </section>;
  };

  return <div className="personalization-grid">
    <section className="theme-control-card">
      <div className="section-heading"><div><p>Appearance</p><h2>Theme</h2></div><span>Saved on this device</span></div>
      <p className="theme-control-copy">Choose how light and dark mode behave, then select a coordinated colour system for every surface and chart.</p>
      <h3 className="theme-subheading">Mode</h3>
      <div className="theme-options" role="radiogroup" aria-label="Application theme">
        {(["system", "light", "dark"] as ThemePreference[]).map((preference) => <button type="button" role="radio" aria-checked={themePreference === preference} className={themePreference === preference ? "active" : ""} key={preference} onClick={() => onThemeChange(preference)}><span aria-hidden="true">{preference === "system" ? "◐" : preference === "light" ? "☀" : "◑"}</span><strong>{preference[0].toUpperCase() + preference.slice(1)}</strong><small>{preference === "system" ? "Follow this device" : preference === "light" ? "Always light" : "Always dark"}</small></button>)}
      </div>
      <h3 className="theme-subheading palette-heading">Colour palette</h3>
      <div className="palette-options" role="radiogroup" aria-label="Application colour palette">
        {(["mono", "forest", "ocean", "indigo", "plum", "terracotta"] as PalettePreference[]).map((preference) => <button type="button" role="radio" aria-checked={palettePreference === preference} className={`palette-option palette-${preference} ${palettePreference === preference ? "active" : ""}`} key={preference} onClick={() => onPaletteChange(preference)}><span className="palette-preview" aria-hidden="true"><i /><i /><i /></span><strong>{preference[0].toUpperCase() + preference.slice(1)}</strong><small>{preference === "mono" ? "Ink and paper" : preference === "forest" ? "Sage and eucalyptus" : preference === "ocean" ? "Navy and sea glass" : preference === "indigo" ? "Ink and periwinkle" : preference === "plum" ? "Aubergine and rose" : "Clay and warm sand"}</small></button>)}
      </div>
    </section>
    <section className="category-library-card">
      <div className="section-heading"><div><p>Quick selection</p><h2>Your categories</h2></div><span>{savingOrder ? "Saving order…" : incomeHidden ? `${categories.filter((category) => category.type === "expense").length} expenses saved` : `${categories.length} saved`}</span></div>
      <p className="personalization-copy">Drag within a section to reorder, or drag across sections to change whether a category appears under Expense or Income.</p>
      <div className="category-library">{renderCategorySection("expense", "Expense", "Spending categories")}{renderCategorySection("income", "Income", "Incoming money")}</div>
      {!categories.length && <div className="category-library-empty">No quick categories yet.</div>}
    </section>
    <section className="category-editor-card">
      <div className="section-heading"><div><p>Local controls</p><h2>{editing ? "Edit category" : "Add category"}</h2></div>{editing && <button onClick={beginAdd}>Add new</button>}</div>
      <form onSubmit={submit}>
        <div className="category-type-toggle" aria-label="Category type"><button type="button" className={categoryType === "expense" ? "active" : ""} onClick={() => setCategoryType("expense")}>Expense</button><button type="button" disabled={incomeHidden} className={categoryType === "income" ? "active" : ""} onClick={() => setCategoryType("income")}>Income</button></div>
        <label className="field-label">Emoji<input className="emoji-input" value={emoji} onChange={(event) => setEmoji(event.target.value)} maxLength={8} placeholder="✨" required /></label>
        <label className="field-label">Category name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={30} placeholder="e.g. Subscriptions" required /></label>
        <p className="category-editor-note">Renaming a category updates every matching past entry. Changing its emoji refreshes the category display throughout your ledger. Removing a shortcut does not delete entries.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="category-editor-actions">{editing && <button type="button" className="danger-button" onClick={remove} disabled={saving}>Remove</button>}<button className="save-category-button" disabled={saving}>{saving ? "Saving…" : editing ? "Save category" : "Add category"}</button></div>
      </form>
    </section>
  </div>;
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}</span><em>{label}</em></button>;
}

function TransactionDrawer({ today, categories, incomeHidden, onClose, onSave, onSaved }: { today: string; categories: LedgerCategory[]; incomeHidden: boolean; onClose: () => void; onSave: (draft: TransactionDraft) => Promise<void>; onSaved: () => void }) {
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const availableCategories = useMemo(() => categories.filter((item) => item.type === type), [categories, type]);
  const [category, setCategory] = useState(categories.find((item) => item.type === "expense")?.name ?? "Other");
  const [account, setAccount] = useState("Everyday");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!availableCategories.some((item) => item.name === category)) {
      setCategory(availableCategories[0]?.name ?? "");
    }
  }, [availableCategories, category]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await onSave({ date, type, amount: Number(amount), category, account, note });
      onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save the transaction."); }
    finally { setSaving(false); }
  };

  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Add transaction">
    <button className="drawer-backdrop" onClick={onClose} aria-label="Close" />
    <form className="transaction-drawer" onSubmit={submit}>
      <div className="drawer-header"><div><p>Quick entry</p><h2>What was this one?</h2></div><button type="button" onClick={onClose}>×</button></div>
      <div className="type-toggle"><button type="button" className={type === "expense" ? "active" : ""} onClick={() => setType("expense")}>Expense</button><button type="button" disabled={incomeHidden} className={type === "income" ? "active" : ""} onClick={() => setType("income")}>Income</button></div>
      <label className="amount-field"><span>A$</span><input autoFocus inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Amount" required /></label>
      <label className="field-label">Note<AutoGrowingNoteInput placeholder={type === "expense" ? "e.g. Coles\n\nMilk - 3.50 AUD" : "e.g. Salary payment"} value={note} onChange={setNote} /></label>
      <fieldset className="category-picker"><legend>Choose a category</legend>{availableCategories.length ? <div>{availableCategories.map((item) => <button type="button" key={item.id} className={category === item.name ? "active" : ""} onClick={() => setCategory(item.name)}><span>{item.emoji}</span>{item.name}</button>)}</div> : <p className="category-picker-empty">No {type} categories yet. Move one into this section in Personalization.</p>}</fieldset>
      <div className="field-row"><label className="field-label">Account<select value={account} onChange={(event) => setAccount(event.target.value)}><option>Everyday</option><option>Credit</option><option>Savings</option><option>Cash</option></select></label><label className="field-label">Date<input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} /></label></div>
      {error && <p className="form-error">{error}</p>}
      <button className="save-button" disabled={saving || !availableCategories.length}>{saving ? "Saving…" : "Save transaction"}</button>
    </form>
  </div>;
}

function AutoGrowingNoteInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const noteField = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (!noteField.current) return;
    noteField.current.style.height = "auto";
    noteField.current.style.height = `${noteField.current.scrollHeight}px`;
  }, [value]);

  return <textarea ref={noteField} className="auto-grow-note" rows={1} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required />;
}

function EditTransactionDrawer({ transaction, categories, incomeHidden, onClose, onSave, onDelete, onSaved, onDeleted }: { transaction: Transaction; categories: LedgerCategory[]; incomeHidden: boolean; onClose: () => void; onSave: (id: string, changes: TransactionChanges) => Promise<void>; onDelete: (id: string) => Promise<void>; onSaved: () => void; onDeleted: () => void }) {
  const [category, setCategory] = useState(transaction.category);
  const [note, setNote] = useState(transaction.note);
  const [account, setAccount] = useState(transaction.account);
  const [amount, setAmount] = useState((transaction.amountCents / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const visibleCategories = useMemo(() => incomeHidden ? categories.filter((item) => item.type === "expense") : categories, [categories, incomeHidden]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await onSave(transaction.id, { category, note, account, amount: Number(amount) });
      onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not update the entry."); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${transaction.note || "this entry"}? This cannot be undone.`)) return;
    setDeleting(true); setError("");
    try {
      await onDelete(transaction.id);
      onDeleted();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Could not delete the entry."); }
    finally { setDeleting(false); }
  };

  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Edit entry">
    <button className="drawer-backdrop" onClick={onClose} aria-label="Close" />
    <form className="transaction-drawer edit-drawer" onSubmit={submit}>
      <div className="drawer-header"><div><p>{longDate(transaction.occurredAt)}</p><h2>Edit entry</h2></div><button type="button" onClick={onClose}>×</button></div>
      <p className="edit-intro">Update the category, note, account and amount used throughout your ledger and CSV exports.</p>
      <label className="field-label">Category<input list="ledger-categories" value={category} onChange={(event) => setCategory(event.target.value)} maxLength={30} required /></label>
      <datalist id="ledger-categories">{visibleCategories.map((item) => <option value={item.name} key={item.id} />)}</datalist>
      <div className="edit-category-chips" aria-label="Quick category selection">{visibleCategories.map((item) => <button type="button" className={category === item.name ? "active" : ""} key={item.id} onClick={() => setCategory(item.name)}><span>{item.emoji}</span>{item.name}</button>)}</div>
      <label className="field-label">Note<AutoGrowingNoteInput value={note} onChange={setNote} /></label>
      <label className="field-label">Account<input list="ledger-accounts" value={account} onChange={(event) => setAccount(event.target.value)} maxLength={40} required /></label>
      <datalist id="ledger-accounts"><option value="Everyday" /><option value="Credit" /><option value="Savings" /><option value="Cash" /></datalist>
      <label className="field-label">Amount<div className="edit-amount"><span>A$</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div></label>
      <div className="entry-context"><span>{transaction.type === "income" ? "Income" : "Expense"}</span><span>{transaction.occurredAt}</span></div>
      {error && <p className="form-error">{error}</p>}
      <button className="save-button" disabled={saving || deleting}>{saving ? "Saving…" : "Save changes"}</button>
      <button type="button" className="delete-entry-button" onClick={remove} disabled={saving || deleting}>{deleting ? "Deleting…" : "Delete entry"}</button>
    </form>
  </div>;
}

function buildDonut(entries: [string, number][]) {
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return "conic-gradient(#e9e7df 0 100%)";
  let cursor = 0;
  const segments = entries.slice(0, 6).map(([, value], index) => {
    const start = cursor;
    cursor += value / total * 100;
    return `${donutColor(index)} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${segments.join(", ")})`;
}

function BrandMark({ className }: { className: string }) {
  const groundId = `brand-mark-${useId().replace(/:/g, "")}`;
  return (
    <svg className={className} viewBox="0 0 512 512" role="img" aria-label="Bro&apos;s Ledger">
      <defs>
        <linearGradient id={groundId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#242629" />
          <stop offset="1" stopColor="#0c0d0e" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill={`url(#${groundId})`} />
      <rect x="130" y="292" width="48" height="88" rx="24" fill="#ffffff" opacity=".2" />
      <rect x="198" y="238" width="48" height="142" rx="24" fill="#ffffff" opacity=".36" />
      <rect x="266" y="184" width="48" height="196" rx="24" fill="#ffffff" opacity=".58" />
      <rect x="334" y="130" width="48" height="250" rx="24" fill="#ffffff" />
    </svg>
  );
}

function RecentlyDeletedPanel({ items, categoryEmoji, retentionDays, onRestore, onPurge, onPurgeAll }: {
  items: DeletedTransaction[];
  categoryEmoji: (name: string) => string;
  retentionDays: number;
  onRestore: (id: string) => Promise<void>;
  onPurge: (id: string) => Promise<void>;
  onPurgeAll: () => Promise<void>;
}) {
  const [confirmingPurgeAll, setConfirmingPurgeAll] = useState(false);
  const ordered = useMemo(() => [...items].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt)), [items]);

  return <div className="transactions-page">
    <section className="report-table-card entry-ledger-card">
      <div className="ledger-toolbar">
        <div><p>Recently deleted</p><h2>{ordered.length} recoverable {ordered.length === 1 ? "entry" : "entries"}</h2><span>Entries are kept for {retentionDays} days, then removed for good</span></div>
        {ordered.length > 0 && <div className="csv-actions"><button type="button" className="csv-button danger-button" onClick={() => { if (!confirmingPurgeAll) { setConfirmingPurgeAll(true); return; } setConfirmingPurgeAll(false); void onPurgeAll(); }} onBlur={() => setConfirmingPurgeAll(false)}>{confirmingPurgeAll ? "Click again to confirm" : "Delete all permanently"}</button></div>}
      </div>
      {ordered.length ? <div className="deleted-list">
        {ordered.map((item) => {
          const elapsed = Math.floor((Date.now() - Date.parse(item.deletedAt)) / 86400000);
          const daysLeft = Math.max(0, retentionDays - elapsed);
          return <div className="deleted-row" key={item.id}>
            <div className="category-icon" style={{ background: `${categoryMeta[item.category]?.color ?? categoryMeta.Other.color}30` }}>{categoryEmoji(item.category)}</div>
            <div className="deleted-copy"><h3>{displayNote(item.note, "Untitled entry")}</h3><p>{item.category} · {item.account} · {longDate(item.occurredAt)}</p></div>
            <div className={`deleted-amount ${item.type}`}><strong>{item.type === "income" ? "+" : "−"}{money(item.amountCents, item.currency)}</strong><span>{daysLeft === 0 ? "Removed today" : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}</span></div>
            <div className="deleted-actions">
              <button type="button" className="deleted-restore" onClick={() => void onRestore(item.id)}>Restore</button>
              <button type="button" className="deleted-purge" onClick={() => void onPurge(item.id)} aria-label={`Delete ${displayNote(item.note, "entry")} permanently`}>Delete</button>
            </div>
          </div>;
        })}
      </div> : <div className="empty-state"><span>🗂</span><h3>Nothing deleted recently</h3><p>Entries you delete are kept here for {retentionDays} days, so a mistake is always recoverable.</p></div>}
    </section>
  </div>;
}
