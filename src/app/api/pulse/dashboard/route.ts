import { NextResponse } from "next/server";
import { sql, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { creators, modelWeights, payouts } from "@/db/schema";

export async function GET() {
  const stageCounts = await db.select({ stage: creators.stage, n: sql<number>`count(*)` }).from(creators).groupBy(creators.stage);
  const postedB = await db.select({ n: sql<number>`count(*)` }).from(creators)
    .where(and(eq(creators.tier, "B"), sql`${creators.stage} in ('posted','paid')`));
  const postedA = await db.select({ n: sql<number>`count(*)` }).from(creators)
    .where(and(eq(creators.tier, "A"), sql`${creators.stage} in ('posted','paid')`));
  // Pending payouts joined with creator context so the UI can render a
  // self-contained decision card (who, how much, is the post clean).
  const pendingPayouts = await db.select({
    id: payouts.id,
    half: payouts.half,
    amountUsd: payouts.amountUsd,
    creatorId: payouts.creatorId,
    handle: creators.handle,
    primaryPlatform: creators.primaryPlatform,
    postUrl: creators.postUrl,
    disclosureOk: creators.disclosureOk,
    tier: creators.tier,
  }).from(payouts)
    .innerJoin(creators, eq(payouts.creatorId, creators.id))
    .where(eq(payouts.status, "pending"));
  const [weights] = await db.select().from(modelWeights);
  return NextResponse.json({
    stageCounts,
    goal: { organic: { current: Number(postedB[0].n), target: 500 }, paid: { current: Number(postedA[0].n), target: 100 } },
    pendingPayouts,
    model: weights ?? { weights: {}, decisionCount: 0 },
  });
}
