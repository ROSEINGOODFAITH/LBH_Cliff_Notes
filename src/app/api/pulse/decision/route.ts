import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
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
  // Approving needs a way to reach them: an email (invite) or an address on
  // file (form-fillers ship directly). Refuse loudly rather than no-op.
  const hasAddress = Boolean((c.sourceMetadata as any)?.shipping);
  if (action !== "reject" && !c.email && !hasAddress)
    return NextResponse.json({ error: "no email on file — creator can't enter outreach" }, { status: 409 });

  const features = extractFeatures(c);

  // Atomically claim the review so a double-tap (two POSTs both reading
  // stage='review') can't emit `creator.tiered` twice — which would place a
  // duplicate free gift order. `tier IS NULL` is the claim token for tiering;
  // moving stage off 'review' is the claim for a reject. If nothing is claimed,
  // someone already decided.
  if (action === "reject") {
    const claimed = await db
      .update(creators)
      .set({ stage: "rejected", updatedAt: new Date() })
      .where(and(eq(creators.id, creatorId), eq(creators.stage, "review")))
      .returning({ id: creators.id });
    if (!claimed.length) return NextResponse.json({ error: "already decided" }, { status: 409 });
  } else {
    const tier = action === "tier_a" ? "A" : "B";
    const claimed = await db
      .update(creators)
      .set({ tier, ...(tier === "A" ? { rateUsd: suggestedRateUsd(c.avgViews) } : {}), updatedAt: new Date() })
      .where(and(eq(creators.id, creatorId), eq(creators.stage, "review"), isNull(creators.tier)))
      .returning({ id: creators.id });
    if (!claimed.length) return NextResponse.json({ error: "already decided" }, { status: 409 });
  }

  await db.insert(decisions).values({ creatorId, action, features });
  await inngest.send({ name: "decision.recorded", data: { creatorId, action, features } });
  if (action !== "reject") {
    await inngest.send({ name: "creator.tiered", data: { creatorId } });
  }
  return NextResponse.json({ ok: true });
}
