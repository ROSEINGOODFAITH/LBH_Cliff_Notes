import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creators, decisions } from "@/db/schema";
import { extractFeatures, suggestedRateUsd } from "@/lib/model";
import { inngest } from "@/lib/inngest";

export async function POST(req: NextRequest) {
  const { creatorId, action } = await req.json(); // action: tier_a | tier_b | reject
  if (!creatorId || !["tier_a", "tier_b", "reject"].includes(action))
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  const c = (await db.select().from(creators).where(eq(creators.id, creatorId)))[0];
  if (!c || c.stage !== "review") return NextResponse.json({ error: "not in review" }, { status: 409 });

  const features = extractFeatures(c);
  await db.insert(decisions).values({ creatorId, action, features });
  await inngest.send({ name: "decision.recorded", data: { creatorId, action, features } });

  if (action === "reject") {
    await db.update(creators).set({ stage: "rejected", updatedAt: new Date() }).where(eq(creators.id, creatorId));
  } else {
    const tier = action === "tier_a" ? "A" : "B";
    await db.update(creators).set({ tier, ...(tier === "A" ? { rateUsd: suggestedRateUsd(c.avgViews) } : {}), updatedAt: new Date() }).where(eq(creators.id, creatorId));
    await inngest.send({ name: "creator.tiered", data: { creatorId } });
  }
  return NextResponse.json({ ok: true });
}
