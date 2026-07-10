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
  const pendingPayouts = await db.select().from(payouts).where(eq(payouts.status, "pending"));
  const [weights] = await db.select().from(modelWeights);
  return NextResponse.json({
    stageCounts, goal: { organic: { current: Number(postedB[0].n), target: 500 }, paid: { current: Number(postedA[0].n), target: 100 } },
    pendingPayouts, model: weights ?? { weights: {}, decisionCount: 0 },
  });
}
