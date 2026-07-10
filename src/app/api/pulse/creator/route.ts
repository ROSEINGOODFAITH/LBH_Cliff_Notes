import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creators } from "@/db/schema";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Save a manually-found email onto a creator (unlocks Tier A/B in review). */
export async function POST(req: NextRequest) {
  const { creatorId, email } = await req.json().catch(() => ({}));
  const clean = String(email ?? "").trim().toLowerCase();
  if (!creatorId || !EMAIL_RE.test(clean))
    return NextResponse.json({ error: "creatorId and a valid email required" }, { status: 400 });
  const c = (await db.select({ id: creators.id }).from(creators).where(eq(creators.id, creatorId)))[0];
  if (!c) return NextResponse.json({ error: "creator not found" }, { status: 404 });
  await db.update(creators).set({ email: clean, updatedAt: new Date() }).where(eq(creators.id, creatorId));
  return NextResponse.json({ ok: true });
}
