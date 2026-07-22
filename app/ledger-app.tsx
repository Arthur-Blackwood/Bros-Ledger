"use client";

import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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

type LedgerCategory = { id: string; name: string; emoji: string };
type View = "overview" | "reports" | "personalization" | "ai";
type LedgerRole = "owner" | "family";

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

const reportNote = (note: string) => note.split(/\r?\n/, 1)[0] || "No note";

const longDate = (dateKey: string) => new Intl.DateTimeFormat("en-AU", {
  month: "long", day: "numeric", weekday: "short",
}).format(new Date(`${dateKey}T12:00:00`));

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
  const [importText, setImportText] = useState(`{
  "transactions": [
    {
      "date": "${today}",
      "type": "expense",
      "amount": 12.80,
      "currency": "AUD",
      "category": "Food",
      "account": "Everyday",
      "note": "Lunch at a neighbourhood cafe",
      "tags": ["receipt"],
      "source": "screenshot"
    }
  ]
}`);

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

  const exportLedger = () => {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), currency, transactions }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `daylight-ledger-${today}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Ledger JSON exported.");
  };

  const exportCsv = () => {
    const escapeCsv = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = transactions.map((item) => [
      item.occurredAt,
      item.category,
      item.note,
      ((item.type === "income" ? 1 : -1) * item.amountCents / 100).toFixed(2),
    ]);
    const csv = [["Date", "Category", "Note", "Amount"], ...rows]
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

  const importLedger = async () => {
    try {
      const parsed = JSON.parse(importText);
      const body = Array.isArray(parsed) ? { transactions: parsed } : parsed;
      const response = await fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Import failed.");
      await loadTransactions();
      setNotice(`${data.count} transaction${data.count === 1 ? "" : "s"} imported.`);
      setView("overview");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The JSON format is not valid.");
    }
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
          {canEdit && <NavItem active={view === "personalization"} icon="✎" label="Personalization" onClick={() => setView("personalization")} />}
          <NavItem active={view === "ai"} icon="✦" label="AI Desk" onClick={() => setView("ai")} />
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
            <p className="eyebrow">{view === "overview" ? "Today under southern skies" : view === "reports" ? "Spending insights" : view === "personalization" ? "Make it yours" : "Built for ChatGPT"}</p>
            <h1>{view === "overview" ? "Money, in a clearer light." : view === "reports" ? "Where did the money go?" : view === "personalization" ? "Your quickest categories." : "From screenshot to ledger."}</h1>
          </div>
          <div className="topbar-actions"><span className={`access-badge ${canEdit ? "owner" : "family"}`}>{canEdit ? "Owner" : "Family · View only"}</span>{canEdit && view === "reports" && <button className="personalize-shortcut" onClick={() => setView("personalization")}>Personalize</button>}{canEdit && <button className="add-button" onClick={() => setDrawerOpen(true)}><span>＋</span> Add transaction</button>}</div>
        </header>

        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {view === "overview" && (
          <div className="dashboard-grid">
            <section className="balance-card">
              <div className="balance-head"><span>Spent this month</span><button aria-label="Spending options">•••</button></div>
              <strong>{money(monthExpense, currency)}</strong>
              <div className="balance-meta">
                <div><span className="legend-dot income" />Income this month <b>{money(monthIncome, currency)}</b></div>
                <div><span className="legend-dot expense" />Net cash flow <b>{money(monthIncome - monthExpense, currency, true)}</b></div>
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
                    <div className="transaction-copy"><h3>{item.note || "Untitled entry"}</h3><p>{item.category} · {item.account}</p></div>
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
          <div className="reports-grid">
            <section className="report-summary">
              <p className="eyebrow">{new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(new Date(`${selectedDate}T12:00:00`))}</p>
              <h2>Spent this month<br /><strong>{money(monthExpense, currency)}</strong></h2>
              <div className="report-badges"><span>Income {money(monthIncome, currency)}</span><span>Net {money(monthIncome - monthExpense, currency, true)}</span></div>
            </section>
            <section className="category-card">
              <div className="section-heading"><div><p>Life in numbers</p><h2>Spending by category</h2></div><span>{categoryTotals.length} categories</span></div>
              <div className="category-visual">
                <div className="donut" style={{ background: buildDonut(categoryTotals) }}><div><strong>{categoryTotals[0]?.[0] ?? "None yet"}</strong><span>Top spend</span></div></div>
                <div className="category-list">{categoryTotals.length ? categoryTotals.slice(0, 5).map(([name, value]) => <div key={name}><span className="category-swatch" style={{ background: categoryMeta[name]?.color ?? categoryMeta.Other.color }} /> <b>{categoryEmoji(name)} {name}</b><span>{money(value, currency)} · {monthExpense ? Math.round(value / monthExpense * 100) : 0}%</span></div>) : <p>Your spending mix will appear after a few entries.</p>}</div>
              </div>
            </section>
            <section className="report-table-card entry-ledger-card">
              <div className="ledger-toolbar">
                <div><p>Detailed ledger</p><h2>All entries</h2><span>Category, Note, Amount</span></div>
                <button className="csv-button" onClick={exportCsv} disabled={!transactions.length}>⇩ Export CSV</button>
              </div>
              {reportGroups.length ? <div className="ledger-table-scroll"><div className="entry-ledger">
                <div className="ledger-column-head"><span>Category</span><span>Note</span><span>Amount</span><span aria-hidden="true" /></div>
                {reportGroups.map(([date, items]) => {
                  const dayNet = items.reduce((sum, item) => sum + (item.type === "income" ? item.amountCents : -item.amountCents), 0);
                  return <section className="ledger-day" key={date}>
                    <div className="ledger-day-head"><strong>{longDate(date)}</strong><span>{items.length} {items.length === 1 ? "entry" : "entries"}</span><b>{money(dayNet, items[0]?.currency ?? currency, true)}</b></div>
                    {items.map((item) => <button className="ledger-entry-row" key={item.id} onClick={() => canEdit && setEditingTransaction(item)} disabled={!canEdit} aria-label={canEdit ? `Edit ${reportNote(item.note)}` : `${item.category}, ${reportNote(item.note)}, view only`}>
                      <span className="ledger-category"><i style={{ background: `${categoryMeta[item.category]?.color ?? categoryMeta.Other.color}30` }}>{categoryEmoji(item.category)}</i><b>{item.category}</b></span>
                      <span className="ledger-note">{reportNote(item.note)}</span>
                      <strong className={item.type}>{item.type === "income" ? "+" : "−"}{money(item.amountCents, item.currency)}</strong>
                      <span className="ledger-edit">{canEdit ? "Edit" : "View"}</span>
                    </button>)}
                  </section>;
                })}
              </div></div> : <div className="ledger-empty"><span>🌿</span><h3>No entries yet</h3><p>{canEdit ? "Add a transaction and it will appear here." : "There are no entries to display."}</p>{canEdit && <button onClick={() => setDrawerOpen(true)}>Add transaction</button>}</div>}
            </section>
          </div>
        )}

        {view === "personalization" && canEdit && <PersonalizationPanel categories={categories} onChanged={loadCategories} />}

        {view === "ai" && (
          <div className="ai-grid">
            <section className="ai-intro-card">
              <span className="ai-orb">✦</span>
              <p className="eyebrow">Made for screenshot bookkeeping</p>
              <h2>Send the bill to ChatGPT.<br />Let AI do the sorting.</h2>
              <p>ChatGPT can read the date, amount, note and category, then return the clean format below. Paste it here and import.</p>
              <ol><li><span>1</span>Send a bill screenshot in our chat</li><li><span>2</span>Ask for Daylight Ledger JSON</li><li><span>3</span>Paste, review and import</li></ol>
              <button onClick={() => copyText("Please turn this bill screenshot into valid Daylight Ledger JSON. Include these fields: date, type, amount, currency, category, account, note, tags and source. Write note in English with the merchant or location on the first line, a blank line, then one purchased item per line in the format Item - amount AUD. Set source to screenshot, and output valid JSON only.", "Prompt for ChatGPT copied.")}>Copy prompt for ChatGPT</button>
            </section>
            {canEdit && <section className="import-card">
              <div className="section-heading"><div><p>Structured entry point</p><h2>Import ledger JSON</h2></div><span>1–300 entries</span></div>
              <textarea value={importText} onChange={(event) => setImportText(event.target.value)} spellCheck={false} aria-label="Ledger JSON" />
              <div className="import-actions"><button className="secondary-button" onClick={() => setImportText("")}>Clear</button><button className="primary-button" onClick={importLedger}>Review and import</button></div>
            </section>}
            <section className="data-card">
              <div><span>⇩</span><div><h3>Download backup</h3><p>A complete JSON copy of every ledger entry.</p></div></div>
              <button onClick={exportLedger}>Backup JSON</button>
            </section>
            <section className="data-card">
              <div><span>☰</span><div><h3>Today's summary</h3><p>A clear note ready to save or share.</p></div></div>
              <button onClick={() => copyText(dailySummary, "Today's summary copied.")}>Copy summary</button>
            </section>
          </div>
        )}
      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavItem active={view === "overview"} icon="⌂" label="Today" onClick={() => setView("overview")} />
        <NavItem active={view === "reports"} icon="↗" label="Reports" onClick={() => setView("reports")} />
        {canEdit ? <button className="mobile-add" onClick={() => setDrawerOpen(true)} aria-label="Add transaction">＋</button> : <button className="mobile-readonly" disabled aria-label="View-only access">◉</button>}
        <NavItem active={view === "ai"} icon="✦" label="AI" onClick={() => setView("ai")} />
        <button onClick={logout}><span>↪</span><em>Log out</em></button>
      </nav>

      {canEdit && drawerOpen && <TransactionDrawer today={today} categories={categories} onClose={() => setDrawerOpen(false)} onSaved={async () => { setDrawerOpen(false); await loadTransactions(); setNotice("Transaction saved."); }} />}
      {canEdit && editingTransaction && <EditTransactionDrawer transaction={editingTransaction} categories={categories} onClose={() => setEditingTransaction(null)} onSaved={async () => { setEditingTransaction(null); await loadTransactions(); setNotice("Entry updated."); }} onDeleted={async () => { setEditingTransaction(null); await loadTransactions(); setNotice("Entry deleted."); }} />}
    </main>
  );
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
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("✨");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const beginEdit = (category: LedgerCategory) => {
    setEditing(category); setName(category.name); setEmoji(category.emoji); setError("");
  };

  const beginAdd = () => {
    setEditing(null); setName(""); setEmoji("✨"); setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch(editing ? `/api/categories?id=${encodeURIComponent(editing.id)}` : "/api/categories", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, emoji }),
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

  return <div className="personalization-grid">
    <section className="category-library-card">
      <div className="section-heading"><div><p>Quick selection</p><h2>Your categories</h2></div><span>{categories.length} saved</span></div>
      <p className="personalization-copy">These appear as shortcuts whenever you edit an entry in Reports.</p>
      <div className="category-library">{categories.map((category) => <button key={category.id} className={editing?.id === category.id ? "active" : ""} onClick={() => beginEdit(category)}><span>{category.emoji}</span><b>{category.name}</b><em>Edit</em></button>)}</div>
      {!categories.length && <div className="category-library-empty">No quick categories yet.</div>}
    </section>
    <section className="category-editor-card">
      <div className="section-heading"><div><p>Owner controls</p><h2>{editing ? "Edit category" : "Add category"}</h2></div>{editing && <button onClick={beginAdd}>Add new</button>}</div>
      <form onSubmit={submit}>
        <label className="field-label">Emoji<input className="emoji-input" value={emoji} onChange={(event) => setEmoji(event.target.value)} maxLength={8} placeholder="✨" required /></label>
        <label className="field-label">Category name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={30} placeholder="e.g. Subscriptions" required /></label>
        <p className="category-editor-note">Renaming or removing a shortcut does not rewrite or delete existing ledger entries.</p>
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
  const expenseCategories = useMemo(() => categories.filter((item) => item.name !== "Income"), [categories]);
  const [category, setCategory] = useState(expenseCategories[0]?.name ?? "Other");
  const [account, setAccount] = useState("Everyday");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (type === "expense" && !expenseCategories.some((item) => item.name === category)) {
      setCategory(expenseCategories[0]?.name ?? "Other");
    }
  }, [expenseCategories, type, category]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, type, amount: Number(amount), currency: "AUD", category: type === "income" ? "Income" : category, account, note, source: "manual" }) });
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
      <div className="type-toggle"><button type="button" className={type === "expense" ? "active" : ""} onClick={() => { setType("expense"); setCategory(expenseCategories[0]?.name ?? "Other"); }}>Expense</button><button type="button" className={type === "income" ? "active" : ""} onClick={() => { setType("income"); setCategory("Income"); }}>Income</button></div>
      <label className="amount-field"><span>A$</span><input autoFocus inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Amount" required /></label>
      <label className="field-label">Note<AutoGrowingNoteInput placeholder={type === "expense" ? "e.g. Coles\n\nMilk - 3.50 AUD" : "e.g. Salary payment"} value={note} onChange={setNote} /></label>
      {type === "expense" && <fieldset className="category-picker"><legend>Choose a category</legend><div>{expenseCategories.map((item) => <button type="button" key={item.id} className={category === item.name ? "active" : ""} onClick={() => setCategory(item.name)}><span>{item.emoji}</span>{item.name}</button>)}</div></fieldset>}
      <div className="field-row"><label className="field-label">Account<select value={account} onChange={(event) => setAccount(event.target.value)}><option>Everyday</option><option>Credit</option><option>Savings</option><option>Cash</option></select></label><label className="field-label">Date<input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} /></label></div>
      {error && <p className="form-error">{error}</p>}
      <button className="save-button" disabled={saving}>{saving ? "Saving…" : "Save transaction"}</button>
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
        body: JSON.stringify({ category, note, amount: Number(amount) }),
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
      <p className="edit-intro">Update the three details used in your report and CSV exports.</p>
      <label className="field-label">Category<input list="ledger-categories" value={category} onChange={(event) => setCategory(event.target.value)} maxLength={30} required /></label>
      <datalist id="ledger-categories">{categories.map((item) => <option value={item.name} key={item.id} />)}</datalist>
      <div className="edit-category-chips" aria-label="Quick category selection">{categories.map((item) => <button type="button" className={category === item.name ? "active" : ""} key={item.id} onClick={() => setCategory(item.name)}><span>{item.emoji}</span>{item.name}</button>)}</div>
      <label className="field-label">Note<AutoGrowingNoteInput value={note} onChange={setNote} /></label>
      <label className="field-label">Amount<div className="edit-amount"><span>A$</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div></label>
      <div className="entry-context"><span>{transaction.type === "income" ? "Income" : "Expense"}</span><span>{transaction.account}</span><span>{transaction.occurredAt}</span></div>
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
  const segments = entries.slice(0, 6).map(([name, value]) => {
    const start = cursor;
    cursor += value / total * 100;
    return `${categoryMeta[name]?.color ?? categoryMeta.Other.color} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${segments.join(", ")})`;
}
