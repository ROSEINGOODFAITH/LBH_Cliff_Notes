import { NextResponse } from "next/server";
import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { creators, payouts, contentMentions, ordersAttributed } from "@/db/schema";
import { computeCockpit } from "@/lib/pulse-phases";
import { AUTOMATION_RULES } from "@/lib/pulse-automations";
import { RINGS } from "@/lib/pulse-rings";
import { brandConfig } from "@/lib/brand";

/**
 * Aggregate everything the PULSE launch cockpit needs in one call: phase state,
 * readiness, bottlenecks, the single Next Best Action, funnel + conversion,
 * ring cohorts, small-team performance metrics, and the automation registry.
 * Read-only. Reuses the canonical stage counts (no parallel lifecycle).
 */
export async function GET() {
  const stageCounts = await db
    .select({ stage: creators.stage, n: sql<number>`count(*)::int` })
    .from(creators)
    .groupBy(creators.stage);

  const ringCounts = await db
    .select({ ring: creators.ring, n: sql<number>`count(*)::int` })
    .from(creators)
    .where(isNotNull(creators.ring))
    .groupBy(creators.ring);

  const [pendingPayouts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payouts)
    .where(eq(payouts.status, "pending"));

  // Content posts not yet reviewed: content mentions with no decision recorded
  // in metricsJson. Cheap proxy for the review queue size.
  const [postsToReview] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contentMentions)
    .where(sql`${contentMentions.metricsJson}->>'decision' is null`);

  const [ordersAgg] = await db
    .select({
      n: sql<number>`count(*)::int`,
      rev: sql<number>`coalesce(sum(${ordersAttributed.subtotalCents}),0)::int`,
    })
    .from(ordersAttributed);

  const c = Object.fromEntries(stageCounts.map((s) => [s.stage, Number(s.n)]));
  const at = (s: string) => c[s] ?? 0;

  const cockpit = computeCockpit({
    stageCounts,
    launchDate: null,
    defineComplete: (Object.values(c).reduce((a, b) => a + Number(b), 0)) > 0,
    pendingPayouts: Number(pendingPayouts?.n ?? 0),
    contentToReview: Number(postsToReview?.n ?? 0),
  });

  // ---- small-team performance metrics (real counts; null when not measurable yet) ----
  const invited = at("contacted") + at("replied") + at("onboarded") + at("shipped") + at("posted") + at("paid");
  const replied = at("replied") + at("onboarded") + at("shipped") + at("posted") + at("paid");
  const shipped = at("onboarded") + at("shipped") + at("posted") + at("paid");
  const posted = at("posted") + at("paid");
  const rate = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 100) : null);

  const metrics = {
    acceptanceRate: rate(replied, invited), // replied / invited
    sampleToPostRate: rate(posted, shipped), // posted / shipped
    usableCreativeRate: rate(posted, shipped), // proxy until per-post rights land
    buyingIntentSignal: Number(ordersAgg?.n ?? 0),
    attributedFirstOrders: Number(ordersAgg?.n ?? 0),
    attributedRevenueCents: Number(ordersAgg?.rev ?? 0),
    repeatPostingRate: null as number | null, // needs multi-post tracking
  };

  return NextResponse.json({
    teamEmail: brandConfig.teamEmails[0] ?? null,
    stageCounts,
    cockpit,
    rings: RINGS.map((r) => ({ ...r, count: Number(ringCounts.find((x) => x.ring === r.key)?.n ?? 0) })),
    metrics,
    automations: AUTOMATION_RULES,
  });
}
