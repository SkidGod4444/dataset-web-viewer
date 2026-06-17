import { NextResponse } from "next/server";
import {
  authConfigured,
  createSessionToken,
  isPasswordCorrect,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth";
import { enforceBrowserOrigin } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Block curl/script brute-forcing of the password in production.
  const blocked = enforceBrowserOrigin(request);
  if (blocked) return blocked;

  if (!authConfigured) {
    return NextResponse.json(
      { ok: false, error: "Auth is not configured (set APP_PASSWORD/AUTH_SECRET)." },
      { status: 500 },
    );
  }

  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    // ignore malformed body
  }

  if (!isPasswordCorrect(password)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
