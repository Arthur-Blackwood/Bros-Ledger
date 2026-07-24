import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { authenticatePin, createSessionToken, hashClientIdentifier, SESSION_COOKIE, SESSION_MAX_AGE } from "../../../ledger-auth";

export const dynamic = "force-dynamic";

type RuntimeEnv = typeof env & { DB?: D1Database };
type AttemptRow = { failed_count: number; window_started: number; locked_until: number };

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const db = (env as RuntimeEnv).DB;
    if (!db) throw new Error("The security database is not connected.");
    await db.prepare(`CREATE TABLE IF NOT EXISTS auth_attempts (
      client_key TEXT PRIMARY KEY NOT NULL,
      failed_count INTEGER NOT NULL DEFAULT 0,
      window_started INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0
    )`).run();

    const forwarded = request.headers.get("cf-connecting-ip")
      ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? "unknown-client";
    const clientKey = await hashClientIdentifier(forwarded);
    const now = Math.floor(Date.now() / 1000);
    const attempt = await db.prepare("SELECT failed_count, window_started, locked_until FROM auth_attempts WHERE client_key = ?")
      .bind(clientKey).first<AttemptRow>();
    if (attempt && attempt.locked_until > now) {
      return noStore(NextResponse.json({ error: "Too many attempts. Please wait before trying again." }, { status: 429 }));
    }

    const body = await request.json();
    const pin = String(body.pin ?? "").trim();
    const requireOwner = body.requireOwner === true;
    const verifyOnly = body.verifyOnly === true;
    const role = /^\d{5}$/.test(pin) ? await authenticatePin(pin) : null;
    if (!role || (requireOwner && role !== "owner")) {
      const withinWindow = Boolean(attempt && now - attempt.window_started < WINDOW_SECONDS);
      const failedCount = withinWindow ? attempt!.failed_count + 1 : 1;
      const windowStarted = withinWindow ? attempt!.window_started : now;
      const lockedUntil = failedCount >= MAX_ATTEMPTS ? now + WINDOW_SECONDS : 0;
      await db.prepare(`INSERT INTO auth_attempts (client_key, failed_count, window_started, locked_until)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(client_key) DO UPDATE SET failed_count = excluded.failed_count, window_started = excluded.window_started, locked_until = excluded.locked_until`)
        .bind(clientKey, failedCount, windowStarted, lockedUntil).run();
      return noStore(NextResponse.json({ error: lockedUntil ? "Too many attempts. Please wait before trying again." : requireOwner ? "Owner PIN required." : "That PIN is not recognised." }, { status: lockedUntil ? 429 : 401 }));
    }

    await db.prepare("DELETE FROM auth_attempts WHERE client_key = ?").bind(clientKey).run();
    if (verifyOnly) return noStore(NextResponse.json({ authenticated: true, role }));
    const response = NextResponse.json({ authenticated: true, role });
    response.cookies.set(SESSION_COOKIE, await createSessionToken(role), {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return noStore(response);
  } catch (error) {
    return noStore(NextResponse.json({ error: error instanceof Error ? error.message : "Could not sign in." }, { status: 500 }));
  }
}
