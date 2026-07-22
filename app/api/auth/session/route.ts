import { NextRequest, NextResponse } from "next/server";
import { readSession } from "../../../ledger-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await readSession(request);
  const response = NextResponse.json(session
    ? { authenticated: true, role: session.role }
    : { authenticated: false, role: null }, { status: session ? 200 : 401 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
