import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, unauthenticated health check: DB connectivity + integration config. */
export async function GET() {
  const body: Record<string, unknown> = { ok: true, ts: new Date().toISOString() };

  try {
    await db.execute(sql`select 1`);
    body.database = "connected";
  } catch {
    body.ok = false;
    body.database = "error";
  }

  try {
    body.integrations = {
      shopify: integrations.shopify(),
      modash: integrations.modash(),
      anthropic: integrations.anthropic(),
      gmail: integrations.gmail(),
    };
  } catch {
    body.integrations = "env_incomplete";
  }

  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
