"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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

type CategoryType = "expense" | "income";
type LedgerCategory = { id: string; name: string; emoji: string; type: CategoryType };
type View = "overview" | "reports" | "transactions" | "personalization";
type LedgerRole = "owner" | "family";
type ExplorerType = "expense" | "income";
type ExplorerGroup = "day" | "month" | "year";
type CategoryPeriod = "month" | "quarter" | "year";
type ActivityView = "both" | "expense" | "income";
type ActivityWeeks = 8 | 16 | 26;

type ReportChartPreferences = {
  explorerType: ExplorerType;
  explorerGroup: ExplorerGroup;
  filterOutliers: boolean;
  categoryPeriod: CategoryPeriod;
  categoryFilterOutliers: boolean;
  groupSmallCategories: boolean;
  activityView: ActivityView;
  activityWeeks: ActivityWeeks;
  activityFilterOutliers: boolean;
};

const reportChartPreferencesKey = "daylight-ledger:report-chart-preferences:v1";
const defaultReportChartPreferences: ReportChartPreferences = {
  explorerType: "expense",
  explorerGroup: "day",
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
    const value = JSON.parse(window.localStorage.getItem(reportChartPreferencesKey) ?? "{}") as Partial<ReportChartPreferences>;
    return {
      explorerType: value.explorerType === "income" ? "income" : "expense",
      explorerGroup: value.explorerGroup === "month" || value.explorerGroup === "year" ? value.explorerGroup : "day",
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
  Health: { emoji: "🌿", color: "#6f9b79" },
  Income: { emoji: "💰", color: "#2f6f62" },
  Other: { emoji: "✨", color: "#a8aea8" },
};

const donutPalette = ["#efc94c", "#5f99aa", "#6f9b79", "#c96745", "#9a76ab", "#4f8f81"];
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
  const [role, setRole] = useState<LedgerRole | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [view, setView] = useState<View>("overview");
  const [selectedDate, setSelectedDate] = useState(today);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<LedgerCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [notice, setNotice] = useState("");

  const loadTransactions = async () => {
    try {
      const response = await fetch("/api/transactions", { cache: "no-store" });
      const data = await response.json();
      if (response.status === 401) {
        setRole(null);
        setTransactions([]);
        return;
      }
      if (!response.ok) throw new Error(data.error || "Could not load the ledger.");
      setTransactions(data.transactions ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The ledger is temporarily offline.");
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch("/api/categories", { cache: "no-store" });
      const data = await response.json();
      if (response.status === 401) {
        setRole(null);
        setCategories([]);
        return;
      }
      if (!response.ok) throw new Error(data.error || "Could not load categories.");
      setCategories(data.categories ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load categories.");
    }
  };

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await response.json();
        setRole(response.ok ? data.role : null);
      } catch { setRole(null); }
      finally { setAuthChecking(false); }
    };
    void checkSession();
  }, []);

  useEffect(() => {
    if (role) {
      setLoading(true);
      void loadTransactions();
      void loadCategories();
    }
  }, [role]);

  const canEdit = role === "owner";
  const visibleTransactions = transactions;
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
    const value = visibleTransactions.filter((item) => item.occurredAt === date && item.type === "expense").reduce((sum, item) => sum + item.amountCents, 0);
    return { date, value };
  }), [selectedDate, visibleTransactions]);
  const maxWeek = Math.max(...weekData.map((item) => item.value), 1);

  const reportGroups = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    transactions.forEach((item) => {
      const group = groups.get(item.occurredAt) ?? [];
      group.push(item);
      groups.set(item.occurredAt, group);
    });
    return Array.from(groups.entries()).sort(([dateA], [dateB]) => dateB.localeCompare(dateA));
  }, [transactions]);

  const dailySummary = `${longDate(selectedDate)}: spent ${money(selectedExpense, currency)}, received ${money(selectedIncome, currency)}, net ${money(selectedIncome - selectedExpense, currency, true)}. ${selectedItems.length ? `${selectedItems.length} transaction${selectedItems.length === 1 ? "" : "s"}${categoryTotals[0] ? `, with ${categoryTotals[0][0]} leading this month` : " recorded"}.` : "No transactions recorded for this day."}`;

  const copyText = async (text: string, message: string) => {
    await navigator.clipboard.writeText(text);
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const exportCsv = () => {
    const escapeCsv = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = transactions.map((item) => [
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
    anchor.download = `daylight-ledger-${today}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("CSV exported.");
  };

  const removeTransaction = async (id: string) => {
    const response = await fetch(`/api/transactions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) {
      setTransactions((items) => items.filter((item) => item.id !== id));
      setNotice("Transaction deleted.");
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setRole(null);
    setTransactions([]);
    setCategories([]);
    setDrawerOpen(false);
    setEditingTransaction(null);
    setView("overview");
  };

  if (authChecking) return <AuthLoading />;
  if (!role) return <PinGate onAuthenticated={setRole} />;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("overview")} aria-label="Go to overview">
          <span className="brand-mark">D</span><span>Daylight Ledger</span>
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          <NavItem active={view === "overview"} icon="⌂" label="Today" onClick={() => setView("overview")} />
          <NavItem active={view === "reports"} icon="↗" label="Reports" onClick={() => setView("reports")} />
          <NavItem active={view === "transactions"} icon="≡" label="Transactions" onClick={() => setView("transactions")} />
          {canEdit && <NavItem active={view === "personalization"} icon="✎" label="Personalization" onClick={() => setView("personalization")} />}
        </nav>
        <div className="sidebar-foot">
          <div className="sync-dot"><span /> Data saved</div>
          <p>{canEdit ? "Owner access" : "Family access · View only"}</p>
          <button className="logout-button" onClick={logout}>Log out</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{view === "overview" ? "Today under southern skies" : view === "reports" ? "Spending insights" : view === "transactions" ? "Detailed ledger" : "Make it yours"}</p>
            <h1>{view === "overview" ? "Money, in a clearer light." : view === "reports" ? "Where did the money go?" : view === "transactions" ? "Every entry, in one place." : "Your quickest categories."}</h1>
          </div>
          <div className="topbar-actions"><span className={`access-badge ${canEdit ? "owner" : "family"}`}>{canEdit ? "Owner" : "Family · View only"}</span>{canEdit && view === "reports" && <button className="personalize-shortcut" onClick={() => setView("personalization")}>Personalize</button>}{canEdit && <button className="add-button" onClick={() => setDrawerOpen(true)}><span>＋</span> Add transaction</button>}</div>
        </header>

        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {view === "overview" && (
          <div className="dashboard-grid">
            <section className="balance-card">
              <div className="balance-head"><span>Net cash flow</span><button aria-label="Cash flow options">•••</button></div>
              <strong>{money(monthIncome - monthExpense, currency, true)}</strong>
              <div className="balance-meta">
                <div><span className="legend-dot income" />Income this month <b>{money(monthIncome, currency)}</b></div>
                <div><span className="legend-dot expense" />Spent this month <b>{money(monthExpense, currency)}</b></div>
              </div>
              <div className="balance-art" aria-hidden="true"><i /><i /><i /></div>
            </section>

            <section className="week-card">
              <div className="section-heading"><div><p>Last 7 days</p><h2>{money(weekData.reduce((sum, item) => sum + item.value, 0), currency)}</h2></div><span>Daily avg. {money(Math.round(weekData.reduce((sum, item) => sum + item.value, 0) / 7), currency)}</span></div>
              <div className="mini-bars" aria-label="Spending over the last seven days">
                {weekData.map((item) => <div className="mini-bar" key={item.date}><i style={{ height: `${Math.max(12, item.value / maxWeek * 100)}%` }} className={item.date === selectedDate ? "current" : ""} /><span>{new Intl.DateTimeFormat("en-AU", { weekday: "narrow" }).format(new Date(`${item.date}T12:00:00`))}</span></div>)}
              </div>
            </section>

            <section className="transactions-card">
              <div className="date-switcher">
                <button onClick={() => setSelectedDate(dateShift(selectedDate, -1))} aria-label="Previous day">‹</button>
                <div><h2>{selectedDate === today ? "Today" : longDate(selectedDate)}</h2><p>{selectedDate} · {selectedItems.length} {selectedItems.length === 1 ? "entry" : "entries"}</p></div>
                <button onClick={() => setSelectedDate(dateShift(selectedDate, 1))} aria-label="Next day" disabled={selectedDate >= today}>›</button>
              </div>
              <div className="day-total"><span>Net for the day</span><strong>{money(selectedIncome - selectedExpense, currency, true)}</strong></div>
              <div className="transaction-list">
                {loading ? <div className="empty-state">Opening your ledger…</div> : selectedItems.length ? selectedItems.map((item) => (
                  <article className="transaction" key={item.id}>
                    <div className="category-icon" style={{ background: `${categoryMeta[item.category]?.color ?? categoryMeta.Other.color}30` }}>{categoryEmoji(item.category)}</div>
                    <div className="transaction-copy"><h3>{displayNote(item.note, "Untitled entry")}</h3><p>{item.category} · {item.account}</p></div>
                    <div className={`transaction-amount ${item.type}`}><strong>{item.type === "income" ? "+" : "−"}{money(item.amountCents, item.currency)}</strong>{item.source === "screenshot" && <span>Screenshot import</span>}</div>
                    {canEdit && <button className="delete-button" onClick={() => removeTransaction(item.id)} aria-label={`Delete ${item.note || "entry"}`}>×</button>}
                  </article>
                )) : <div className="empty-state"><span>🌿</span><h3>A quiet day so far</h3><p>{canEdit ? "Add the first entry when you are ready." : "No transactions are recorded for this day."}</p>{canEdit && <button onClick={() => setDrawerOpen(true)}>Add transaction</button>}</div>}
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
          <ReportsPanel transactions={transactions} selectedDate={selectedDate} currency={currency} categoryEmoji={categoryEmoji} canEdit={canEdit} onShowTransactions={() => setView("transactions")} onEditTransaction={(transaction) => { setView("transactions"); setEditingTransaction(transaction); }} />
        )}

        {view === "transactions" && <TransactionsPanel groups={reportGroups} currency={currency} canEdit={canEdit} categoryEmoji={categoryEmoji} onEdit={setEditingTransaction} onExport={exportCsv} onAdd={() => setDrawerOpen(true)} />}

        {view === "personalization" && canEdit && <PersonalizationPanel categories={categories} onChanged={async () => { await Promise.all([loadCategories(), loadTransactions()]); }} />}

      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavItem active={view === "overview"} icon="⌂" label="Today" onClick={() => setView("overview")} />
        <NavItem active={view === "reports"} icon="↗" label="Reports" onClick={() => setView("reports")} />
        {canEdit ? <button className="mobile-add" onClick={() => setDrawerOpen(true)} aria-label="Add transaction">＋</button> : <button className="mobile-readonly" disabled aria-label="View-only access">◉</button>}
        <NavItem active={view === "transactions"} icon="≡" label="Transactions" onClick={() => setView("transactions")} />
        <button onClick={logout}><span>↪</span><em>Log out</em></button>
      </nav>

      {canEdit && drawerOpen && <TransactionDrawer today={today} categories={categories} onClose={() => setDrawerOpen(false)} onSaved={async () => { setDrawerOpen(false); await loadTransactions(); setNotice("Transaction saved."); }} />}
      {canEdit && editingTransaction && <EditTransactionDrawer transaction={editingTransaction} categories={categories} onClose={() => setEditingTransaction(null)} onSaved={async () => { setEditingTransaction(null); await loadTransactions(); setNotice("Entry updated."); }} onDeleted={async () => { setEditingTransaction(null); await loadTransactions(); setNotice("Entry deleted."); }} />}
    </main>
  );
}

function ReportsPanel({ transactions, selectedDate, currency, categoryEmoji, canEdit, onShowTransactions, onEditTransaction }: {
  transactions: Transaction[];
  selectedDate: string;
  currency: string;
  categoryEmoji: (name: string) => string;
  canEdit: boolean;
  onShowTransactions: () => void;
  onEditTransaction: (transaction: Transaction) => void;
}) {
  const [explorerType, setExplorerType] = useState<ExplorerType>("expense");
  const [explorerGroup, setExplorerGroup] = useState<ExplorerGroup>("day");
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

  useEffect(() => {
    const saved = readReportChartPreferences();
    setExplorerType(saved.explorerType);
    setExplorerGroup(saved.explorerGroup);
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
  }, [chartPreferencesReady, explorerType, explorerGroup, filterOutliers, categoryPeriod, categoryFilterOutliers, groupSmallCategories, activityView, activityWeeks, activityFilterOutliers]);

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

  const rawSeries = useMemo(() => {
    const grouped = new Map<string, number>();
    transactions.filter((item) => item.type === explorerType).forEach((item) => {
      const key = explorerKey(item.occurredAt, explorerGroup);
      grouped.set(key, (grouped.get(key) ?? 0) + item.amountCents);
    });
    return Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({ key, value }));
  }, [transactions, explorerType, explorerGroup]);

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
  const activityDetails = selectedActivityDate ? transactions.filter((item) => item.occurredAt === selectedActivityDate && (activityView === "both" || item.type === activityView)) : [];
  const explorerDetails = selectedExplorerKey ? transactions.filter((item) => item.type === explorerType && explorerKey(item.occurredAt, explorerGroup) === selectedExplorerKey) : [];

  const shareExplorer = async () => {
    const text = `${explorerType === "expense" ? "Expenditure" : "Income"} total: ${money(explorerTotal, currency)}. Highest ${money(explorerHighest, currency)}, lowest ${money(explorerLowest, currency)}, average ${money(explorerAverage, currency)}.`;
    if (navigator.share) await navigator.share({ title: "Daylight Ledger report", text });
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
      <div className="analysis-heading"><div><p>Last {activityWeeks} weeks</p><h2>{activityView === "both" ? "Cash flow activity" : activityView === "expense" ? "Expenditure activity" : "Income activity"}</h2></div><button className="help-button" onClick={() => setOpenInfo((current) => current === "activity" ? null : "activity")} aria-label="About cash flow activity" aria-expanded={openInfo === "activity"} aria-controls="activity-info">?</button></div>
      {openInfo === "activity" && <InfoCallout id="activity-info">Each square is one calendar day. In Both mode, days containing income and expenditure are split into two colours; a day containing only one flow uses that colour across the whole cell, and an empty day stays neutral. Outlier filtering caps the colour scale so unusual days do not flatten the rest of the chart. Exact transactions remain unchanged and available when you click a date.</InfoCallout>}
      <div className="activity-controls">
        <div><span>Display</span><div className="segmented-control group-control">{(["both", "expense", "income"] as ActivityView[]).map((view) => <button type="button" key={view} className={activityView === view ? "active" : ""} onClick={() => { setActivityView(view); setSelectedActivityDate(null); }}>{view === "both" ? "Both" : view === "expense" ? "Expense" : "Income"}</button>)}</div></div>
        <div><span>Period</span><div className="segmented-control group-control">{([8, 16, 26] as ActivityWeeks[]).map((weeks) => <button type="button" key={weeks} className={activityWeeks === weeks ? "active" : ""} onClick={() => { setActivityWeeks(weeks); setSelectedActivityDate(null); }}>{weeks} weeks</button>)}</div></div>
        <div><span>Filter outliers</span><button type="button" className={`outlier-toggle ${activityFilterOutliers ? "active" : ""}`} onClick={() => setActivityFilterOutliers((value) => !value)} aria-pressed={activityFilterOutliers}>{activityFilterOutliers ? "Filtering" : "Include all"}</button></div>
      </div>
      <div className="activity-grid" style={{ gridTemplateColumns: `repeat(${activityWeeks}, minmax(7px, 1fr))` }} aria-label={`Daily ${activityView === "both" ? "income and expenditure" : activityView} over the last ${activityWeeks} weeks`}>
        {activity.map((item) => {
          const expenseLevel = activityLevel(item.expense, expenseActivityMax);
          const incomeLevel = activityLevel(item.income, incomeActivityMax);
          const hasBoth = activityView === "both" && item.expense > 0 && item.income > 0;
          const singleType = activityView === "both" ? item.expense > 0 ? "expense" : item.income > 0 ? "income" : "" : activityView;
          const singleLevel = singleType === "expense" ? expenseLevel : singleType === "income" ? incomeLevel : 0;
          const description = `${longDate(item.date)}: expenditure ${money(item.expense, currency)}, income ${money(item.income, currency)}, net ${money(item.income - item.expense, currency, true)}`;
          return <button key={item.date} type="button" className={`activity-cell ${hasBoth ? "split" : singleType} ${hasBoth ? "" : `level-${singleLevel}`} ${selectedActivityDate === item.date ? "selected" : ""}`} title={description} aria-label={`Show activity for ${description}`} aria-pressed={selectedActivityDate === item.date} onClick={() => setSelectedActivityDate((current) => current === item.date ? null : item.date)}>{hasBoth && <><i className={`activity-half expense level-${expenseLevel}`} /><i className={`activity-half income level-${incomeLevel}`} /></>}</button>;
        })}
      </div>
      <div className="activity-legend">{activityView !== "income" && <span><i className="expense level-3" />Expense · scale to {money(expenseActivityMax, currency)}</span>}{activityView !== "expense" && <span><i className="income level-3" />Income · scale to {money(incomeActivityMax, currency)}</span>}<span><i className="level-0" />No activity</span><small>Darker colour means a larger daily total.</small></div>
      {selectedActivityDate && <ReportDetailPanel title={longDate(selectedActivityDate)} subtitle={activityView === "both" ? "Cash flow activity" : activityView === "expense" ? "Expenditure activity" : "Income activity"} items={activityDetails} currency={currency} categoryEmoji={categoryEmoji} canEdit={canEdit} onEdit={onEditTransaction} onClose={() => setSelectedActivityDate(null)} />}
    </section>

    <section className="explorer-card analysis-card">
      <div className="explorer-head"><div><p>Transactions explorer</p><h2>{money(explorerTotal, currency)}</h2><span>{series.length} {explorerGroup === "day" ? "days" : explorerGroup === "month" ? "months" : "years"} included</span></div><button className="share-report" onClick={shareExplorer} aria-label="Share report summary">{shareStatus || "↗"}</button></div>
      {series.length ? <>
        <div className="trend-chart" aria-label={`${explorerType} grouped by ${explorerGroup}`}>
          <div className="trend-y-labels"><span>{money(chartMax, currency)}</span><span>{money(chartMax / 2, currency)}</span><span>{money(0, currency)}</span></div>
          <div className="trend-bars">{series.map((item) => <button type="button" className={`trend-bar-wrap ${selectedExplorerKey === item.key ? "selected" : ""}`} key={item.key} title={`${explorerLabel(item.key, explorerGroup)}: ${money(item.value, currency)}`} aria-label={`Show ${explorerType} details for ${explorerLabel(item.key, explorerGroup)}: ${money(item.value, currency)}`} aria-pressed={selectedExplorerKey === item.key} onClick={() => setSelectedExplorerKey((current) => current === item.key ? null : item.key)}><i style={{ height: `${Math.max(3, item.value / chartMax * 100)}%` }} /></button>)}</div>
          <div className="trend-x-labels">{tickIndexes.map((index) => <span key={series[index].key}>{explorerLabel(series[index].key, explorerGroup)}</span>)}</div>
        </div>
        {selectedExplorerKey && series.some((item) => item.key === selectedExplorerKey) && <ReportDetailPanel title={explorerLabel(selectedExplorerKey, explorerGroup)} subtitle={explorerType === "expense" ? "Expenditure" : "Income"} items={explorerDetails} currency={currency} categoryEmoji={categoryEmoji} canEdit={canEdit} onEdit={onEditTransaction} onClose={() => setSelectedExplorerKey(null)} />}
        <div className="explorer-stats"><div><span>Highest</span><strong>{money(explorerHighest, currency)}</strong></div><div><span>Lowest</span><strong>{money(explorerLowest, currency)}</strong></div><div><span>Amplitude</span><strong>{money(explorerHighest - explorerLowest, currency)}</strong></div><div><span>Average</span><strong>{money(explorerAverage, currency)}</strong></div></div>
      </> : <div className="explorer-empty">No {explorerType} data for this selection.</div>}
      <div className="explorer-controls">
        <div><span>Transaction type</span><div className="segmented-control"><button className={explorerType === "expense" ? "active" : ""} onClick={() => { setExplorerType("expense"); setSelectedExplorerKey(null); }}>Expenditure</button><button className={explorerType === "income" ? "active" : ""} onClick={() => { setExplorerType("income"); setSelectedExplorerKey(null); }}>Income</button></div></div>
        <div><span>Group by</span><div className="segmented-control group-control">{(["day", "month", "year"] as ExplorerGroup[]).map((group) => <button key={group} className={explorerGroup === group ? "active" : ""} onClick={() => { setExplorerGroup(group); setSelectedExplorerKey(null); }}>{group[0].toUpperCase() + group.slice(1)}</button>)}</div></div>
        <div><span>Filter outliers <button className="help-inline" onClick={() => setOpenInfo((current) => current === "outliers" ? null : "outliers")} aria-label="About outlier filtering" aria-expanded={openInfo === "outliers"} aria-controls="outlier-info">?</button></span><button className={`outlier-toggle ${filterOutliers ? "active" : ""}`} onClick={() => { setFilterOutliers((value) => !value); setSelectedExplorerKey(null); }} aria-pressed={filterOutliers}>{filterOutliers ? "Filtering" : "Include all"}</button></div>
      </div>
      {openInfo === "outliers" && <InfoCallout id="outlier-info">When enabled, the chart and summary exclude unusually large or small grouped totals using the standard 1.5× interquartile-range rule. Your underlying transactions are never changed or deleted.</InfoCallout>}
      <button className="show-transactions" onClick={onShowTransactions}><span>Show all transactions</span><b>{transactions.length}</b></button>
    </section>
  </div>;
}

function ReportDetailPanel({ title, subtitle, items, currency, categoryEmoji, canEdit, onEdit, onClose }: { title: string; subtitle: string; items: Transaction[]; currency: string; categoryEmoji: (name: string) => string; canEdit: boolean; onEdit: (transaction: Transaction) => void; onClose: () => void }) {
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
        {items.map((item) => <div className="report-detail-row" key={item.id}><time dateTime={item.occurredAt}>{item.occurredAt}</time><span className="report-detail-category"><small className="report-detail-mobile-label">Category</small><i aria-hidden="true">{categoryEmoji(item.category)}</i><span>{item.category}</span></span><strong>{displayNote(item.note)}</strong><span className="report-detail-account"><small className="report-detail-mobile-label">Account</small><span>{item.account}</span></span><b className={item.type}>{item.type === "income" ? "+" : "−"}{money(item.amountCents, item.currency || currency)}</b>{canEdit ? <button className="report-detail-edit" type="button" onClick={() => editItem(item)} aria-label={`Edit ${displayNote(item.note)}`}>Edit</button> : <span className="report-detail-action-spacer" />}</div>)}
      </div> : <p className="report-detail-empty">No expenditure was recorded for this date.</p>}
    </section>
  </div>;
}

function InfoCallout({ id, children }: { id: string; children: ReactNode }) {
  return <aside className="info-callout" id={id} role="note"><span>i</span><p>{children}</p></aside>;
}

function TransactionsPanel({ groups, currency, canEdit, categoryEmoji, onEdit, onExport, onAdd }: {
  groups: [string, Transaction[]][];
  currency: string;
  canEdit: boolean;
  categoryEmoji: (name: string) => string;
  onEdit: (transaction: Transaction) => void;
  onExport: () => void;
  onAdd: () => void;
}) {
  const transactionCount = groups.reduce((sum, [, items]) => sum + items.length, 0);
  return <div className="transactions-page">
    <section className="report-table-card entry-ledger-card">
      <div className="ledger-toolbar">
        <div><p>Detailed ledger</p><h2>All entries</h2><span>{transactionCount} transactions · Category, note, account and amount</span></div>
        <button className="csv-button" onClick={onExport} disabled={!transactionCount}>⇩ Export CSV</button>
      </div>
      {groups.length ? <div className="ledger-table-scroll"><div className="entry-ledger">
        <div className="ledger-column-head"><span>Category</span><span>Note</span><span>Account</span><span>Amount</span><span aria-hidden="true" /></div>
        {groups.map(([date, items]) => {
          const dayNet = items.reduce((sum, item) => sum + (item.type === "income" ? item.amountCents : -item.amountCents), 0);
          return <section className="ledger-day" key={date}>
            <div className="ledger-day-head"><strong>{longDate(date)}</strong><span>{items.length} {items.length === 1 ? "entry" : "entries"}</span><b>{money(dayNet, items[0]?.currency ?? currency, true)}</b></div>
            {items.map((item) => <button className="ledger-entry-row" key={item.id} onClick={() => canEdit && onEdit(item)} disabled={!canEdit} aria-label={canEdit ? `Edit ${displayNote(item.note)}, ${item.account}` : `${item.category}, ${displayNote(item.note)}, ${item.account}, view only`}>
              <span className="ledger-category"><i style={{ background: `${categoryMeta[item.category]?.color ?? categoryMeta.Other.color}30` }}>{categoryEmoji(item.category)}</i><b>{item.category}</b></span>
              <span className="ledger-note">{displayNote(item.note)}</span>
              <span className="ledger-account">{item.account}</span>
              <strong className={item.type}>{item.type === "income" ? "+" : "−"}{money(item.amountCents, item.currency)}</strong>
              <span className="ledger-edit">{canEdit ? "Edit" : "View"}</span>
            </button>)}
          </section>;
        })}
      </div></div> : <div className="ledger-empty"><span>🌿</span><h3>No entries yet</h3><p>{canEdit ? "Add a transaction and it will appear here." : "There are no entries to display."}</p>{canEdit && <button onClick={onAdd}>Add transaction</button>}</div>}
    </section>
  </div>;
}

function AuthLoading() {
  return <main className="auth-shell"><div className="auth-card auth-loading"><span className="auth-mark">D</span><p>Opening your private ledger…</p></div></main>;
}

function PinGate({ onAuthenticated }: { onAuthenticated: (role: LedgerRole) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not sign in.");
      setPin("");
      onAuthenticated(data.role);
    } catch (signInError) { setError(signInError instanceof Error ? signInError.message : "Could not sign in."); }
    finally { setSubmitting(false); }
  };

  return <main className="auth-shell">
    <section className="auth-card">
      <div className="auth-mark">D</div>
      <p className="eyebrow">Daylight Ledger</p>
      <h1>Your family ledger,<br />kept private.</h1>
      <p className="auth-copy">Enter your five-digit PIN to continue. Your access level is selected automatically.</p>
      <form onSubmit={submit}>
        <label>Access PIN<input autoFocus type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{5}" maxLength={5} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="•••••" aria-describedby={error ? "pin-error" : undefined} required /></label>
        {error && <p className="auth-error" id="pin-error" role="alert">{error}</p>}
        <button disabled={submitting || pin.length !== 5}>{submitting ? "Checking…" : "Unlock ledger"}</button>
      </form>
      <div className="auth-assurance"><span>●</span><p><b>Private by design</b><br />Ledger data is never loaded before sign-in.</p></div>
    </section>
  </main>;
}

function PersonalizationPanel({ categories, onChanged }: { categories: LedgerCategory[]; onChanged: () => Promise<void> }) {
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
      const response = await fetch("/api/categories", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        expenseIds: ordered.filter((category) => category.type === "expense").map((category) => category.id),
        incomeIds: ordered.filter((category) => category.type === "income").map((category) => category.id),
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the category order.");
      await onChanged();
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : "Could not save the category order.");
      await onChanged();
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
      const response = await fetch(editing ? `/api/categories?id=${encodeURIComponent(editing.id)}` : "/api/categories", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, emoji, categoryType }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the category.");
      await onChanged();
      beginAdd();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save the category."); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!editing || !window.confirm(`Remove ${editing.name} from quick selection? Existing ledger entries will not be deleted.`)) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/categories?id=${encodeURIComponent(editing.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove the category.");
      await onChanged();
      beginAdd();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Could not remove the category."); }
    finally { setSaving(false); }
  };

  const renderCategorySection = (type: CategoryType, title: string, description: string) => {
    const group = orderedCategories.filter((category) => category.type === type);
    return <section className="category-group">
      <div className="category-group-heading"><div><strong>{title}</strong><span>{description}</span></div><em>{group.length}</em></div>
      <div className="category-drop-zone" data-category-type={type}>
        {group.map((category) => <div key={category.id} data-category-id={category.id} className={`category-library-item ${editing?.id === category.id ? "active" : ""} ${draggingCategory === category.id ? "dragging" : ""}`}><button type="button" className="category-edit-button" onClick={() => beginEdit(category)}><span>{category.emoji}</span><b>{category.name}</b><em>Edit</em></button><button type="button" className="category-drag-handle" aria-label={`Drag ${category.name} to reorder or move it between Expense and Income. Use arrow keys for the same actions.`} onPointerDown={(event) => startCategoryDrag(event, category.id)} onKeyDown={(event) => moveCategoryWithKeyboard(event, category.id)}>⠿</button></div>)}
        {!group.length && <div className="category-drop-empty">Drag categories here</div>}
      </div>
    </section>;
  };

  return <div className="personalization-grid">
    <section className="category-library-card">
      <div className="section-heading"><div><p>Quick selection</p><h2>Your categories</h2></div><span>{savingOrder ? "Saving order…" : `${categories.length} saved`}</span></div>
      <p className="personalization-copy">Drag within a section to reorder, or drag across sections to change whether a category appears under Expense or Income.</p>
      <div className="category-library">{renderCategorySection("expense", "Expense", "Spending categories")}{renderCategorySection("income", "Income", "Incoming money")}</div>
      {!categories.length && <div className="category-library-empty">No quick categories yet.</div>}
    </section>
    <section className="category-editor-card">
      <div className="section-heading"><div><p>Owner controls</p><h2>{editing ? "Edit category" : "Add category"}</h2></div>{editing && <button onClick={beginAdd}>Add new</button>}</div>
      <form onSubmit={submit}>
        <div className="category-type-toggle" aria-label="Category type"><button type="button" className={categoryType === "expense" ? "active" : ""} onClick={() => setCategoryType("expense")}>Expense</button><button type="button" className={categoryType === "income" ? "active" : ""} onClick={() => setCategoryType("income")}>Income</button></div>
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

function TransactionDrawer({ today, categories, onClose, onSaved }: { today: string; categories: LedgerCategory[]; onClose: () => void; onSaved: () => void }) {
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
      const response = await fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, type, amount: Number(amount), currency: "AUD", category, account, note, source: "manual" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the transaction.");
      await onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save the transaction."); }
    finally { setSaving(false); }
  };

  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Add transaction">
    <button className="drawer-backdrop" onClick={onClose} aria-label="Close" />
    <form className="transaction-drawer" onSubmit={submit}>
      <div className="drawer-header"><div><p>Quick entry</p><h2>What was this one?</h2></div><button type="button" onClick={onClose}>×</button></div>
      <div className="type-toggle"><button type="button" className={type === "expense" ? "active" : ""} onClick={() => setType("expense")}>Expense</button><button type="button" className={type === "income" ? "active" : ""} onClick={() => setType("income")}>Income</button></div>
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

  return <textarea ref={noteField} className="auto-grow-note" rows={1} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={240} required />;
}

function EditTransactionDrawer({ transaction, categories, onClose, onSaved, onDeleted }: { transaction: Transaction; categories: LedgerCategory[]; onClose: () => void; onSaved: () => void; onDeleted: () => void }) {
  const [category, setCategory] = useState(transaction.category);
  const [note, setNote] = useState(transaction.note);
  const [account, setAccount] = useState(transaction.account);
  const [amount, setAmount] = useState((transaction.amountCents / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch(`/api/transactions?id=${encodeURIComponent(transaction.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, note, account, amount: Number(amount) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update the entry.");
      await onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not update the entry."); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${transaction.note || "this entry"}? This cannot be undone.`)) return;
    setDeleting(true); setError("");
    try {
      const response = await fetch(`/api/transactions?id=${encodeURIComponent(transaction.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete the entry.");
      await onDeleted();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Could not delete the entry."); }
    finally { setDeleting(false); }
  };

  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Edit entry">
    <button className="drawer-backdrop" onClick={onClose} aria-label="Close" />
    <form className="transaction-drawer edit-drawer" onSubmit={submit}>
      <div className="drawer-header"><div><p>{longDate(transaction.occurredAt)}</p><h2>Edit entry</h2></div><button type="button" onClick={onClose}>×</button></div>
      <p className="edit-intro">Update the category, note, account and amount used throughout your ledger and CSV exports.</p>
      <label className="field-label">Category<input list="ledger-categories" value={category} onChange={(event) => setCategory(event.target.value)} maxLength={30} required /></label>
      <datalist id="ledger-categories">{categories.map((item) => <option value={item.name} key={item.id} />)}</datalist>
      <div className="edit-category-chips" aria-label="Quick category selection">{categories.map((item) => <button type="button" className={category === item.name ? "active" : ""} key={item.id} onClick={() => setCategory(item.name)}><span>{item.emoji}</span>{item.name}</button>)}</div>
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
