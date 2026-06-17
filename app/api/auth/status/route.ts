import { NextResponse } from "next/server";
import { authConfigured, isAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({
    authed: isAuthenticated(request),
    configured: authConfigured,
  });
}
