import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creators, events } from "@/db/schema";
import { coerceRelationshipTier } from "@/lib/relationship";

/**
 * Set / clear a creator's relationship tier (COLD/WARM/FAM). Mirrors the ring
 * route: this ONLY writes `creators.relationshipTier` and never touches the
 * canonical stage or the ring. Clerk-protected via middleware.
 */
export async function POST(req: NextRequest) {
  const { creatorId, relationshipTier } = await req.json().catch(() => ({}));
  if (!creatorId || typeof creatorId !== "string")
    return NextResponse.json({ error: "creatorId required" }, { status: 400 });

  // Allow null/empty to clear; otherwise must be a valid tier.
  const value = relationshipTier == null || relationshipTier === "" ? null : coerceRelationshipTier(relationshipTier);
  if (relationshipTier != null && relationshipTier !== "" && value === null)
    return NextResponse.json({ error: "invalid relationship tier" }, { status: 400 });

  const updated = await db
    .update(creators)
    .set({ relationshipTier: value, updatedAt: new Date() })
    .where(eq(creators.id, creatorId))
    .returning({ id: creators.id, relationshipTier: creators.relationshipTier });
  if (!updated.length) return NextResponse.json({ error: "creator not found" }, { status: 404 });

  await db.insert(events).values({ creatorId, type: "relationship.assigned", payload: { relationshipTier: value } });
  return NextResponse.json({ ok: true, relationshipTier: value });
}
