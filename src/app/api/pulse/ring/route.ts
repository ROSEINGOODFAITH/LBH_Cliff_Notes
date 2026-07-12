import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creators, events } from "@/db/schema";
import { isRingKey } from "@/lib/pulse-rings";

/**
 * Assign / clear a creator's PULSE operational ring (human-in-the-loop). Rings
 * are orthogonal to the canonical stage — this only writes `creators.ring` and
 * never changes lifecycle stage. Clerk-protected via middleware.
 */
export async function POST(req: NextRequest) {
  const { creatorId, ring } = await req.json();
  if (!creatorId || typeof creatorId !== "string")
    return NextResponse.json({ error: "creatorId required" }, { status: 400 });
  // Allow null/empty to clear the ring; otherwise it must be a valid ring key.
  const value = ring == null || ring === "" ? null : ring;
  if (value !== null && !isRingKey(value))
    return NextResponse.json({ error: "invalid ring" }, { status: 400 });

  const updated = await db
    .update(creators)
    .set({ ring: value, updatedAt: new Date() })
    .where(eq(creators.id, creatorId))
    .returning({ id: creators.id, ring: creators.ring });
  if (!updated.length) return NextResponse.json({ error: "creator not found" }, { status: 404 });

  await db.insert(events).values({ creatorId, type: "ring.assigned", payload: { ring: value } });
  return NextResponse.json({ ok: true, ring: value });
}
