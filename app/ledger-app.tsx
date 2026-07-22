"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Transaction = {
  id: string;
  occurredAt: string;
  type: "expense" | "income";
  amountCents: number;
  currency: string;
  merchant: string;
  category: string;
  account: string;
  note: string;
  tags: string[];
  source: string;
};

type View = "overview" | "reports" | "ai";

const categoryMeta: Record<string, { emoji: string; color: string }> = {
  餐饮: { emoji: "🍜", color: "#ff9f7f" },
  交通: { emoji: "🚆", color: "#83c6b0" },
  购物: { emoji: "🛍️", color: "#f2cf6d" },
  居家: { emoji: "🏠", color: "#97afd9" },
  娱乐: { emoji: "🎬", color: "#c0a1d8" },
  健康: { emoji: "🌿", color: "#86b98b" },
  收入: { emoji: "💰", color: "#74b995" },
  其他: { emoji: "✨", color: "#aeb5b1" },
};

const categoryNames = Object.keys(categoryMeta);

const toDateKey = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const dateShift = (dateKey: string, amount: number) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
};

const demoTransactions = (today: string): Transaction[] => [
  { id: "demo-1", occurredAt: today, type: "expense", amountCents: 1850, currency: "AUD", merchant: "Edition Roasters", category: "餐饮", account: "日常卡", note: "早午餐", tags: ["朋友"], source: "demo" },
  { id: "demo-2", occurredAt: today, type: "expense", amountCents: 480, currency: "AUD", merchant: "Metro", category: "交通", account: "日常卡", note: "", tags: [], source: "demo" },
  { id: "demo-3", occurredAt: today, type: "expense", amountCents: 3290, currency: "AUD", merchant: "MUJI", category: "购物", account: "信用卡", note: "收纳用品", tags: ["家"], source: "demo" },
  { id: "demo-4", occurredAt: dateShift(today, -1), type: "income", amountCents: 320000, currency: "AUD", merchant: "项目收入", category: "收入", account: "储蓄卡", note: "", tags: [], source: "demo" },
  { id: "demo-5", occurredAt: dateShift(today, -1), type: "expense", amountCents: 2460, currency: "AUD", merchant: "Woolworths", category: "居家", account: "日常卡", note: "本周杂货", tags: [], source: "demo" },
  { id: "demo-6", occurredAt: dateShift(today, -3), type: "expense", amountCents: 1550, currency: "AUD", merchant: "Palace Cinema", category: "娱乐", account: "信用卡", note: "", tags: [], source: "demo" },
];

const money = (cents: number, currency = "AUD", signed = false) => {
  const value = cents / 100;
  const text = new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 2 }).format(Math.abs(value));
  if (!signed || cents === 0) return text;
  return `${cents > 0 ? "+" : "−"}${text}`;
};

const longDate = (dateKey: string) => new Intl.DateTimeFormat("zh-CN", {
  month: "long", day: "numeric", weekday: "short",
}).format(new Date(`${dateKey}T12:00:00`));

export function LedgerApp() {
  const today = useMemo(() => toDateKey(), []);
  const [view, setView] = useState<View>("overview");
  const [selectedDate, setSelectedDate] = useState(today);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [importText, setImportText] = useState(`{
  "transactions": [
    {
      "date": "${today}",
      "type": "expense",
      "amount": 12.80,
      "currency": "AUD",
      "merchant": "账单商户",
      "category": "餐饮",
      "account": "日常卡",
      "note": "由账单截图识别",
      "tags": ["截图导入"],
      "source": "screenshot"
    }
  ]
}`);

  const loadTransactions = async () => {
    try {
      const response = await fetch("/api/transactions", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取失败");
      setTransactions(data.transactions ?? []);
    } catch {
      setNotice("暂时无法连接账本数据，正在显示示例界面。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTransactions(); }, []);

  const isDemo = !loading && transactions.length === 0;
  const visibleTransactions = isDemo ? demoTransactions(today) : transactions;
  const currency = visibleTransactions[0]?.currency ?? "AUD";
  const selectedItems = visibleTransactions.filter((item) => item.occurredAt === selectedDate);
  const selectedExpense = selectedItems.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amountCents, 0);
  const selectedIncome = selectedItems.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amountCents, 0);
  const monthKey = selectedDate.slice(0, 7);
  const monthItems = visibleTransactions.filter((item) => item.occurredAt.startsWith(monthKey));
  const monthExpense = monthItems.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amountCents, 0);
  const monthIncome = monthItems.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amountCents, 0);
  const totalBalance = visibleTransactions.reduce((sum, item) => sum + (item.type === "income" ? item.amountCents : -item.amountCents), 0);

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

  const dailySummary = `${longDate(selectedDate)}：支出 ${money(selectedExpense, currency)}，收入 ${money(selectedIncome, currency)}，净额 ${money(selectedIncome - selectedExpense, currency, true)}。${selectedItems.length ? `共 ${selectedItems.length} 笔，${categoryTotals[0] ? `本月主要支出为${categoryTotals[0][0]}` : "已完成记录"}。` : "当天暂无记录。"}`;

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
    anchor.download = `拾光账本-${today}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("账本 JSON 已导出");
  };

  const importLedger = async () => {
    try {
      const parsed = JSON.parse(importText);
      const body = Array.isArray(parsed) ? { transactions: parsed } : parsed;
      const response = await fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "导入失败");
      await loadTransactions();
      setNotice(`已导入 ${data.count} 笔账单`);
      setView("overview");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "JSON 格式不正确");
    }
  };

  const removeTransaction = async (id: string) => {
    if (id.startsWith("demo-")) return;
    const response = await fetch(`/api/transactions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) {
      setTransactions((items) => items.filter((item) => item.id !== id));
      setNotice("已删除这笔记录");
    }
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("overview")} aria-label="回到首页">
          <span className="brand-mark">拾</span><span>拾光账本</span>
        </button>
        <nav className="main-nav" aria-label="主要导航">
          <NavItem active={view === "overview"} icon="⌂" label="今日" onClick={() => setView("overview")} />
          <NavItem active={view === "reports"} icon="↗" label="报表" onClick={() => setView("reports")} />
          <NavItem active={view === "ai"} icon="✦" label="AI 工作台" onClick={() => setView("ai")} />
        </nav>
        <div className="sidebar-foot">
          <div className="sync-dot"><span /> 数据已保存</div>
          <p>默认币种 · AUD</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{view === "overview" ? "今日账本" : view === "reports" ? "收支洞察" : "给 ChatGPT 的入口"}</p>
            <h1>{view === "overview" ? "把生活，记得刚刚好" : view === "reports" ? "钱都花去哪了？" : "截图变账单，一次搞定"}</h1>
          </div>
          <button className="add-button" onClick={() => setDrawerOpen(true)}><span>＋</span> 记一笔</button>
        </header>

        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
        {isDemo && <div className="demo-banner"><span>正在预览示例数据</span><p>添加第一笔后，这些示例会自动消失。</p><button onClick={() => setDrawerOpen(true)}>开始记账</button></div>}

        {view === "overview" && (
          <div className="dashboard-grid">
            <section className="balance-card">
              <div className="balance-head"><span>可见结余</span><button aria-label="切换金额显示">•••</button></div>
              <strong>{money(totalBalance, currency)}</strong>
              <div className="balance-meta">
                <div><span className="legend-dot income" />本月收入 <b>{money(monthIncome, currency)}</b></div>
                <div><span className="legend-dot expense" />本月支出 <b>{money(monthExpense, currency)}</b></div>
              </div>
              <div className="balance-art" aria-hidden="true"><i /><i /><i /></div>
            </section>

            <section className="week-card">
              <div className="section-heading"><div><p>近 7 天</p><h2>{money(weekData.reduce((sum, item) => sum + item.value, 0), currency)}</h2></div><span>日均 {money(Math.round(weekData.reduce((sum, item) => sum + item.value, 0) / 7), currency)}</span></div>
              <div className="mini-bars" aria-label="最近七天支出柱状图">
                {weekData.map((item) => <div className="mini-bar" key={item.date}><i style={{ height: `${Math.max(12, item.value / maxWeek * 100)}%` }} className={item.date === selectedDate ? "current" : ""} /><span>{new Intl.DateTimeFormat("zh-CN", { weekday: "narrow" }).format(new Date(`${item.date}T12:00:00`))}</span></div>)}
              </div>
            </section>

            <section className="transactions-card">
              <div className="date-switcher">
                <button onClick={() => setSelectedDate(dateShift(selectedDate, -1))} aria-label="前一天">‹</button>
                <div><h2>{selectedDate === today ? "今天" : longDate(selectedDate)}</h2><p>{selectedDate} · {selectedItems.length} 笔</p></div>
                <button onClick={() => setSelectedDate(dateShift(selectedDate, 1))} aria-label="后一天" disabled={selectedDate >= today}>›</button>
              </div>
              <div className="day-total"><span>当日净额</span><strong>{money(selectedIncome - selectedExpense, currency, true)}</strong></div>
              <div className="transaction-list">
                {loading ? <div className="empty-state">正在打开账本…</div> : selectedItems.length ? selectedItems.map((item) => (
                  <article className="transaction" key={item.id}>
                    <div className="category-icon" style={{ background: `${categoryMeta[item.category]?.color ?? categoryMeta.其他.color}30` }}>{categoryMeta[item.category]?.emoji ?? "✨"}</div>
                    <div className="transaction-copy"><h3>{item.merchant}</h3><p>{item.category} · {item.account}{item.note ? ` · ${item.note}` : ""}</p></div>
                    <div className={`transaction-amount ${item.type}`}><strong>{item.type === "income" ? "+" : "−"}{money(item.amountCents, item.currency)}</strong>{item.source === "screenshot" && <span>截图导入</span>}</div>
                    {!item.id.startsWith("demo-") && <button className="delete-button" onClick={() => removeTransaction(item.id)} aria-label={`删除 ${item.merchant}`}>×</button>}
                  </article>
                )) : <div className="empty-state"><span>🪴</span><h3>这一天还很安静</h3><p>记下第一笔，让今天有迹可循。</p><button onClick={() => setDrawerOpen(true)}>记一笔</button></div>}
              </div>
            </section>

            <section className="daily-note-card">
              <div className="note-top"><span className="spark">✦</span><p>每日小结</p><button onClick={() => copyText(dailySummary, "每日小结已复制")}>复制</button></div>
              <h2>{selectedExpense ? `今天花了 ${money(selectedExpense, currency)}` : "今天还没有支出"}</h2>
              <p>{dailySummary}</p>
              <div className="note-tags"><span>自动生成</span><span>{selectedItems.length} 笔交易</span></div>
            </section>
          </div>
        )}

        {view === "reports" && (
          <div className="reports-grid">
            <section className="report-summary">
              <p className="eyebrow">{monthKey.replace("-", " 年 ")} 月</p>
              <h2>本月共支出<br /><strong>{money(monthExpense, currency)}</strong></h2>
              <div className="report-badges"><span>收入 {money(monthIncome, currency)}</span><span>结余 {money(monthIncome - monthExpense, currency, true)}</span></div>
            </section>
            <section className="category-card">
              <div className="section-heading"><div><p>生活配方</p><h2>分类支出</h2></div><span>{categoryTotals.length} 个分类</span></div>
              <div className="category-visual">
                <div className="donut" style={{ background: buildDonut(categoryTotals) }}><div><strong>{categoryTotals[0]?.[0] ?? "暂无"}</strong><span>最大支出</span></div></div>
                <div className="category-list">{categoryTotals.length ? categoryTotals.slice(0, 5).map(([name, value]) => <div key={name}><span className="category-swatch" style={{ background: categoryMeta[name]?.color ?? categoryMeta.其他.color }} /> <b>{categoryMeta[name]?.emoji ?? "✨"} {name}</b><span>{money(value, currency)} · {monthExpense ? Math.round(value / monthExpense * 100) : 0}%</span></div>) : <p>记几笔之后，这里会出现你的生活配方。</p>}</div>
              </div>
            </section>
            <section className="report-table-card">
              <div className="section-heading"><div><p>每日账单</p><h2>最近 7 天</h2></div><button onClick={() => copyText(dailySummary, "今日账单已复制")}>复制今日</button></div>
              <div className="daily-table">{weekData.slice().reverse().map((day) => {
                const count = visibleTransactions.filter((item) => item.occurredAt === day.date).length;
                return <button key={day.date} onClick={() => { setSelectedDate(day.date); setView("overview"); }}><span>{longDate(day.date)}</span><span>{count} 笔</span><strong>{money(day.value, currency)}</strong><i>›</i></button>;
              })}</div>
            </section>
          </div>
        )}

        {view === "ai" && (
          <div className="ai-grid">
            <section className="ai-intro-card">
              <span className="ai-orb">✦</span>
              <p className="eyebrow">为截图记账而生</p>
              <h2>把账单截图发给我，<br />剩下的交给 AI。</h2>
              <p>我会识别日期、金额、商户和分类，整理成下方的标准格式。你只需粘贴并导入。</p>
              <ol><li><span>1</span>把账单截图发到我们的对话</li><li><span>2</span>让我输出“拾光账本 JSON”</li><li><span>3</span>粘贴、检查、导入</li></ol>
              <button onClick={() => copyText("请把这张账单截图整理成拾光账本 JSON。字段包含：date, type, amount, currency, merchant, category, account, note, tags, source。source 固定为 screenshot。只输出合法 JSON。", "给 ChatGPT 的提示词已复制")}>复制给 ChatGPT 的提示词</button>
            </section>
            <section className="import-card">
              <div className="section-heading"><div><p>结构化入口</p><h2>导入账单 JSON</h2></div><span>1–300 笔</span></div>
              <textarea value={importText} onChange={(event) => setImportText(event.target.value)} spellCheck={false} aria-label="账单 JSON" />
              <div className="import-actions"><button className="secondary-button" onClick={() => setImportText("")}>清空</button><button className="primary-button" onClick={importLedger}>检查并导入</button></div>
            </section>
            <section className="data-card">
              <div><span>⇩</span><div><h3>完整账本备份</h3><p>标准 JSON，方便我读取、分析或迁移。</p></div></div>
              <button onClick={exportLedger}>导出 JSON</button>
            </section>
            <section className="data-card">
              <div><span>☰</span><div><h3>今日小结</h3><p>一段可以直接发给自己的清晰摘要。</p></div></div>
              <button onClick={() => copyText(dailySummary, "今日小结已复制")}>复制小结</button>
            </section>
          </div>
        )}
      </section>

      <nav className="mobile-nav" aria-label="移动端导航">
        <NavItem active={view === "overview"} icon="⌂" label="今日" onClick={() => setView("overview")} />
        <NavItem active={view === "reports"} icon="↗" label="报表" onClick={() => setView("reports")} />
        <button className="mobile-add" onClick={() => setDrawerOpen(true)} aria-label="记一笔">＋</button>
        <NavItem active={view === "ai"} icon="✦" label="AI" onClick={() => setView("ai")} />
        <button><span>⚙</span><em>设置</em></button>
      </nav>

      {drawerOpen && <TransactionDrawer today={today} onClose={() => setDrawerOpen(false)} onSaved={async () => { setDrawerOpen(false); await loadTransactions(); setNotice("这一笔，记好了"); }} />}
    </main>
  );
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}</span><em>{label}</em></button>;
}

function TransactionDrawer({ today, onClose, onSaved }: { today: string; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("餐饮");
  const [account, setAccount] = useState("日常卡");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, type, amount: Number(amount), currency: "AUD", merchant, category: type === "income" ? "收入" : category, account, note, source: "manual" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      await onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "保存失败"); }
    finally { setSaving(false); }
  };

  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="记一笔">
    <button className="drawer-backdrop" onClick={onClose} aria-label="关闭" />
    <form className="transaction-drawer" onSubmit={submit}>
      <div className="drawer-header"><div><p>快速记账</p><h2>这一笔是什么？</h2></div><button type="button" onClick={onClose}>×</button></div>
      <div className="type-toggle"><button type="button" className={type === "expense" ? "active" : ""} onClick={() => setType("expense")}>支出</button><button type="button" className={type === "income" ? "active" : ""} onClick={() => { setType("income"); setCategory("收入"); }}>收入</button></div>
      <label className="amount-field"><span>A$</span><input autoFocus inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="金额" required /></label>
      <label className="field-label">商户 / 来源<input placeholder={type === "expense" ? "例如：超市、咖啡店" : "例如：工资、退款"} value={merchant} onChange={(event) => setMerchant(event.target.value)} required /></label>
      {type === "expense" && <fieldset className="category-picker"><legend>选择分类</legend><div>{categoryNames.filter((name) => name !== "收入").map((name) => <button type="button" key={name} className={category === name ? "active" : ""} onClick={() => setCategory(name)}><span>{categoryMeta[name].emoji}</span>{name}</button>)}</div></fieldset>}
      <div className="field-row"><label className="field-label">账户<select value={account} onChange={(event) => setAccount(event.target.value)}><option>日常卡</option><option>信用卡</option><option>储蓄卡</option><option>现金</option></select></label><label className="field-label">日期<input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} /></label></div>
      <label className="field-label">备注（可选）<input placeholder="给未来的自己一点线索" value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="save-button" disabled={saving}>{saving ? "正在保存…" : "记下这一笔"}</button>
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
    return `${categoryMeta[name]?.color ?? categoryMeta.其他.color} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${segments.join(", ")})`;
}
