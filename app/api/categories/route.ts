import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { readSession } from "../../ledger-auth";

export const dynamic = "force-dynamic";

type RuntimeEnv = typeof env & { DB?: D1Database };
type CategoryType = "expense" | "income";
type CategoryRow = { id: string; name: string; emoji: string; category_type: CategoryType; sort_order: number };

const starterCategories = [
  ["Food", "🍜"], ["Transport", "🚆"], ["Shopping", "🛍️"], ["Home", "🏠"],
  ["Fun", "🎬"], ["Health", "🌿"], ["Income", "💰"], ["Other", "✨"],
] as const;

async function getDatabase() {
  const db = (env as RuntimeEnv).DB;
  if (!db) throw new Error("The ledger database is not connected yet.");
  await db.prepare(`CREATE TABLE IF NOT EXISTS ledger_categories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    emoji TEXT NOT NULL DEFAULT '✨',
    category_type TEXT NOT NULL DEFAULT 'expense',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const columns = await db.prepare("PRAGMA table_info(ledger_categories)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "category_type")) {
    await db.prepare("ALTER TABLE ledger_categories ADD COLUMN category_type TEXT NOT NULL DEFAULT 'expense'").run();
    await db.prepare("UPDATE ledger_categories SET category_type = 'income', sort_order = 0 WHERE LOWER(name) = 'income'").run();
  }
  return db;
}

async function seedCategories(db: D1Database) {
  const count = await db.prepare("SELECT COUNT(*) AS total FROM ledger_categories").first<{ total: number }>();
  if (Number(count?.total ?? 0) > 0) return;
  const existing = await db.prepare("SELECT DISTINCT category AS name FROM transactions WHERE TRIM(category) <> '' ORDER BY category").all<{ name: string }>();
  const names = new Map<string, string>(starterCategories);
  existing.results.forEach((row) => { if (!names.has(row.name)) names.set(row.name, "✨"); });
  await db.batch(Array.from(names.entries()).map(([name, emoji], index) => db.prepare(
    "INSERT OR IGNORE INTO ledger_categories (id, name, emoji, category_type, sort_order) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), name, emoji, name === "Income" ? "income" : "expense", name === "Income" ? 0 : index)));
}

function cleanCategory(body: Record<string, unknown>) {
  const name = String(body.name ?? "").trim().slice(0, 30);
  const emoji = String(body.emoji ?? "✨").trim().slice(0, 8) || "✨";
  const categoryType: CategoryType = body.categoryType === "income" ? "income" : "expense";
  if (!name) throw new Error("Category name is required.");
  return { name, emoji, categoryType };
}

export async function GET(request: NextRequest) {
  try {
    const session = await readSession(request);
    if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const db = await getDatabase();
    await seedCategories(db);
    const result = await db.prepare("SELECT id, name, emoji, category_type, sort_order FROM ledger_categories ORDER BY CASE category_type WHEN 'expense' THEN 0 ELSE 1 END, sort_order, name").all<CategoryRow>();
    return NextResponse.json({ categories: result.results.map((row) => ({ id: row.id, name: row.name, emoji: row.emoji, type: row.category_type })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load categories." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await readSession(request);
    if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (session.role !== "owner") return NextResponse.json({ error: "This account has view-only access." }, { status: 403 });
    const { name, emoji, categoryType } = cleanCategory(await request.json());
    const db = await getDatabase();
    const order = await db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM ledger_categories WHERE category_type = ?").bind(categoryType).first<{ next_order: number }>();
    const category = { id: crypto.randomUUID(), name, emoji, type: categoryType };
    await db.prepare("INSERT INTO ledger_categories (id, name, emoji, category_type, sort_order) VALUES (?, ?, ?, ?, ?)")
      .bind(category.id, name, emoji, categoryType, Number(order?.next_order ?? 0)).run();
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the category.";
    return NextResponse.json({ error: message.includes("UNIQUE") ? "That category already exists." : message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await readSession(request);
    if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (session.role !== "owner") return NextResponse.json({ error: "This account has view-only access." }, { status: 403 });
    const id = request.nextUrl.searchParams.get("id");
    if (!id) throw new Error("A category ID is required.");
    const { name, emoji, categoryType } = cleanCategory(await request.json());
    const db = await getDatabase();
    const existing = await db.prepare("SELECT id, name, category_type FROM ledger_categories WHERE id = ?").bind(id).first<{ id: string; name: string; category_type: CategoryType }>();
    if (!existing) return NextResponse.json({ error: "Category not found." }, { status: 404 });
    let nextOrder: number | null = null;
    if (existing.category_type !== categoryType) {
      const order = await db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM ledger_categories WHERE category_type = ?").bind(categoryType).first<{ next_order: number }>();
      nextOrder = Number(order?.next_order ?? 0);
    }
    const statements = [nextOrder === null
      ? db.prepare("UPDATE ledger_categories SET name = ?, emoji = ? WHERE id = ?").bind(name, emoji, id)
      : db.prepare("UPDATE ledger_categories SET name = ?, emoji = ?, category_type = ?, sort_order = ? WHERE id = ?").bind(name, emoji, categoryType, nextOrder, id)];
    if (existing.name !== name) statements.unshift(db.prepare("UPDATE transactions SET category = ? WHERE category = ?").bind(name, existing.name));
    const results = await db.batch(statements);
    const syncedTransactions = existing.name === name ? 0 : Number(results[0]?.meta.changes ?? 0);
    return NextResponse.json({ category: { id, name, emoji, type: categoryType }, syncedTransactions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the category.";
    return NextResponse.json({ error: message.includes("UNIQUE") ? "That category already exists." : message }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await readSession(request);
    if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (session.role !== "owner") return NextResponse.json({ error: "This account has view-only access." }, { status: 403 });
    const body = await request.json();
    const expenseIds = Array.isArray(body.expenseIds) ? body.expenseIds.map((id: unknown) => String(id)) : [];
    const incomeIds = Array.isArray(body.incomeIds) ? body.incomeIds.map((id: unknown) => String(id)) : [];
    const ids = [...expenseIds, ...incomeIds];
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error("A valid category order is required.");
    const db = await getDatabase();
    await seedCategories(db);
    const existing = await db.prepare("SELECT id FROM ledger_categories").all<{ id: string }>();
    const existingIds = new Set(existing.results.map((category) => category.id));
    if (existingIds.size !== ids.length || ids.some((id: string) => !existingIds.has(id))) throw new Error("The category list changed. Refresh and try again.");
    await db.batch([
      ...expenseIds.map((id: string, index: number) => db.prepare("UPDATE ledger_categories SET category_type = 'expense', sort_order = ? WHERE id = ?").bind(index, id)),
      ...incomeIds.map((id: string, index: number) => db.prepare("UPDATE ledger_categories SET category_type = 'income', sort_order = ? WHERE id = ?").bind(index, id)),
    ]);
    return NextResponse.json({ ok: true, expenseIds, incomeIds });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not reorder categories." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await readSession(request);
    if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (session.role !== "owner") return NextResponse.json({ error: "This account has view-only access." }, { status: 403 });
    const id = request.nextUrl.searchParams.get("id");
    if (!id) throw new Error("A category ID is required.");
    const db = await getDatabase();
    await db.prepare("DELETE FROM ledger_categories WHERE id = ?").bind(id).run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete the category." }, { status: 400 });
  }
}
