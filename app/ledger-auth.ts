import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

export type LedgerRole = "owner" | "family";

type SessionPayload = {
  v: 1;
  role: LedgerRole;
  issuedAt: number;
  expiresAt: number;
};

type LedgerEnv = typeof env & {
  OWNER_PIN?: string;
  FAMILY_PIN?: string;
  SESSION_SECRET?: string;
};

export const SESSION_COOKIE = "bros_ledger_session";
export const LEGACY_SESSION_COOKIE = "daylight_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

const encoder = new TextEncoder();

function getSecrets() {
  const runtime = env as LedgerEnv;
  if (!runtime.OWNER_PIN || !runtime.FAMILY_PIN || !runtime.SESSION_SECRET) {
    throw new Error("Ledger authentication is not configured.");
  }
  return {
    ownerPin: runtime.OWNER_PIN,
    familyPin: runtime.FAMILY_PIN,
    sessionSecret: runtime.SESSION_SECRET,
  };
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function safeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function sign(value: string) {
  const { sessionSecret } = getSecrets();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function authenticatePin(pin: string): Promise<LedgerRole | null> {
  const { ownerPin, familyPin } = getSecrets();
  const [candidateHash, ownerHash, familyHash] = await Promise.all([
    digest(pin), digest(ownerPin), digest(familyPin),
  ]);
  if (safeEqual(candidateHash, ownerHash)) return "owner";
  if (safeEqual(candidateHash, familyHash)) return "family";
  return null;
}

export async function createSessionToken(role: LedgerRole) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { v: 1, role, issuedAt, expiresAt: issuedAt + SESSION_MAX_AGE };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = toBase64Url(await sign(encodedPayload));
  return `${encodedPayload}.${signature}`;
}

export async function readSession(request: NextRequest): Promise<SessionPayload | null> {
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value ?? request.cookies.get(LEGACY_SESSION_COOKIE)?.value;
    if (!token) return null;
    const [encodedPayload, encodedSignature, extra] = token.split(".");
    if (!encodedPayload || !encodedSignature || extra) return null;
    const expectedSignature = await sign(encodedPayload);
    if (!safeEqual(fromBase64Url(encodedSignature), expectedSignature)) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as SessionPayload;
    if (payload.v !== 1 || !["owner", "family"].includes(payload.role) || payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function hashClientIdentifier(identifier: string) {
  return toBase64Url(await sign(`client:${identifier}`));
}
