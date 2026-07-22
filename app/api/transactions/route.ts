import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { readSession } from "../../ledger-auth";

export const dynamic = "force-dynamic";

type TransactionInput = {
  id?: string;
  occurredAt?: string;
  date?: string;
  type?: "expense" | "income";
  amount?: number;
  amountCents?: number;
  currency?: string;
  merchant?: string;
  category?: string;
  account?: string;
  note?: string;
  tags?: string[];
  source?: "manual" | "screenshot" | "import";
};

type RuntimeEnv = typeof env & { DB?: D1Database };

async function getDatabase() {
  const db = (env as RuntimeEnv).DB;
  if (!db) throw new Error("The ledger database is not connected yet.");

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY NOT NULL,
      occurred_at TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      currency TEXT NOT NULL DEFAULT 'AUD',
      merchant TEXT NOT NULL,
      category TEXT NOT NULL,
      account TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions (occurred_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions (category)"),
  ]);
  return db;
}

function normalize(input: TransactionInput) {
  const date = input.occurredAt ?? input.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Dates must use the YYYY-MM-DD format.");

  const amountCents = Number.isInteger(input.amountCents)
    ? Math.abs(input.amountCents as number)
    : Math.round(Math.abs(Number(input.amount ?? 0)) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error("The amount must be greater than zero.");

  const type = input.type === "income" ? "income" : "expense";
  const merchant = String(input.merchant ?? "Untitled transaction").trim().slice(0, 80) || "Untitled transaction";
  const category = String(input.category ?? (type === "income" ? "Income" : "Other")).trim().slice(0, 30);
  const account = String(input.account ?? "Everyday").trim().slice(0, 40);
  const note = String(input.note ?? "").trim().slice(0, 240);
  const currency = String(input.currency ?? "AUD").trim().toUpperCase().slice(0, 3) || "AUD";
  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12)
    : [];
  const source = ["manual", "screenshot", "import"].includes(String(input.source))
    ? String(input.source)
    : "manual";

  return {
    id: input.id && /^[a-zA-Z0-9_-]{6,80}$/.test(input.id) ? input.id : crypto.randomUUID(),
    occurredAt: date,
    type,
    amountCents,
    currency,
    merchant,
    category,
    account,
    note,
    tags,
    source,
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await readSession(request);
    if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const db = await getDatabase();
    const date = request.nextUrl.searchParams.get("date");
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 500), 1), 1000);
    const statement = date
      ? db.prepare("SELECT * FROM transactions WHERE occurred_at = ? ORDER BY created_at DESC LIMIT ?").bind(date, limit)
      : db.prepare("SELECT * FROM transactions ORDER BY occurred_at DESC, created_at DESC LIMIT ?").bind(limit);
    const result = await statement.all();
    const transactions = result.results.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      type: row.type,
      amountCents: row.amount_cents,
      currency: row.currency,
      merchant: row.merchant,
      category: row.category,
      account: row.account,
      note: row.note,
      tags: JSON.parse(String(row.tags || "[]")),
      source: row.source,
      createdAt: row.created_at,
    }));
    return NextResponse.json({ transactions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the ledger." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await readSession(request);
    if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (session.role !== "owner") return NextResponse.json({ error: "This account has view-only access." }, { status: 403 });
    const db = await getDatabase();
    const body = await request.json();
    const inputs: TransactionInput[] = Array.isArray(body)
      ? body
      : Array.isArray(body.transactions)
        ? body.transactions
        : [body];
    if (!inputs.length || inputs.length > 300) throw new Error("Import between 1 and 300 transactions at a time.");
    const transactions = inputs.map(normalize);
    await db.batch(transactions.map((item) => db.prepare(`INSERT OR REPLACE INTO transactions
      (id, occurred_at, type, amount_cents, currency, merchant, category, account, note, tags, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(item.id, item.occurredAt, item.type, item.amountCents, item.currency, item.merchant, item.category, item.account, item.note, JSON.stringify(item.tags), item.source)));
    return NextResponse.json({ transactions, count: transactions.length }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the transaction." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await readSession(request);
    if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (session.role !== "owner") return NextResponse.json({ error: "This account has view-only access." }, { status: 403 });
    const id = request.nextUrl.searchParams.get("id");
    if (!id) throw new Error("A transaction ID is required.");
    const body = await request.json();
    const category = String(body.category ?? "").trim().slice(0, 30);
    const merchant = String(body.note ?? "").trim().slice(0, 80);
    const amountCents = Math.round(Math.abs(Number(body.amount ?? 0)) * 100);
    if (!category) throw new Error("Category is required.");
    if (!merchant) throw new Error("Note is required.");
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error("The amount must be greater than zero.");

    const db = await getDatabase();
    const existing = await db.prepare("SELECT id FROM transactions WHERE id = ?").bind(id).first();
    if (!existing) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    await db.prepare("UPDATE transactions SET category = ?, merchant = ?, amount_cents = ? WHERE id = ?")
      .bind(category, merchant, amountCents, id).run();
    return NextResponse.json({ ok: true, transaction: { id, category, merchant, amountCents } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update the transaction." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await readSession(request);
    if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (session.role !== "owner") return NextResponse.json({ error: "This account has view-only access." }, { status: 403 });
    const id = request.nextUrl.searchParams.get("id");
    if (!id) throw new Error("A transaction ID is required.");
    const db = await getDatabase();
    await db.prepare("DELETE FROM transactions WHERE id = ?").bind(id).run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete the transaction." }, { status: 400 });
  }
}
