import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creators, payouts } from "@/db/schema";

export async function POST(req: NextRequest) {
  const { payoutId, approve } = await req.json();
  if (!payoutId || typeof approve !== "boolean")
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  const p = (await db.select().from(payouts).where(eq(payouts.id, payoutId)))[0];
  if (!p || p.status !== "pending") return NextResponse.json({ error: "not pending" }, { status: 409 });

  await db.update(payouts).set({
    status: approve ? "approved" : "pending", approvedBy: approve ? "david" : null,
  }).where(eq(payouts.id, payoutId));

  // completion payout approval closes out the creator
  if (approve && p.half === "completion") {
    await db.update(creators).set({ stage: "paid", updatedAt: new Date() }).where(eq(creators.id, p.creatorId));
  }
  return NextResponse.json({ ok: true });
  // Note: this marks approval only — the actual transfer happens in your payment rail, never automatically.
}
