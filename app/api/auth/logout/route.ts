import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "../../../ledger-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
