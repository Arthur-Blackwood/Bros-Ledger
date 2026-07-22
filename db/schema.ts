import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  occurredAt: text("occurred_at").notNull(),
  type: text("type", { enum: ["expense", "income"] }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("AUD"),
  merchant: text("merchant").notNull(),
  category: text("category").notNull(),
  account: text("account").notNull(),
  note: text("note").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  source: text("source").notNull().default("manual"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const authAttempts = sqliteTable("auth_attempts", {
  clientKey: text("client_key").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  windowStarted: integer("window_started").notNull(),
  lockedUntil: integer("locked_until").notNull().default(0),
});
