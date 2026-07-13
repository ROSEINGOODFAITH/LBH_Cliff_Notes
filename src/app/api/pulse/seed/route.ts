import { NextResponse } from "next/server";
import { inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { creators, payouts, contentMentions, ordersAttributed, affiliates } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { pulseFit, type FitInput } from "@/lib/pulse-fit";
import { suggestRing } from "@/lib/pulse-rings";
import type { CreatorStage } from "@/lib/lifecycle";

/**
 * Guarded PULSE demo seeder. Populates a realistic launch snapshot — creators
 * across every stage and ring, a couple of pending payouts, content mentions
 * (some awaiting review), and attributed orders — so the cockpit is legible
 * without a live pipeline.
 *
 * SAFETY: only runs in MOCK mode (`MOCK=1`), which production never sets, so it
 * can never touch real data. Every row is tagged `sourceMetadata.demo = true`, and
 * DELETE removes exactly those rows — the seed is fully reversible and never
 * collides with imported/enriched creators.
 */
const DEMO_MARKER = { demo: true, seededBy: "pulse-seed" };

type SeedCreator = {
  handle: string;
  displayName: string;
  platform: "tiktok" | "instagram";
  stage: CreatorStage;
  fit: FitInput;
  source?: "first_party";
};

const SEED: SeedCreator[] = [
  // --- Discover / sourced (top of funnel, still enriching) ---
  { handle: "velvetgrapes", displayName: "Mara Vela", platform: "tiktok", stage: "sourced",
    fit: { followerCount: 42000, engagementRate: 0.061, avgViews: 38000, geo: "US", niche: "fragrance", nicheTags: ["fragrance", "perfumetok"], aestheticScore: 78, fakeFollowerPct: 4 } },
  { handle: "aerobicafterdark", displayName: "Dee Fontaine", platform: "tiktok", stage: "sourced",
    fit: { followerCount: 88000, engagementRate: 0.052, avgViews: 71000, geo: "US", niche: "dance", nicheTags: ["aerobics", "80s", "dance"], aestheticScore: 71, fakeFollowerPct: 7 } },
  { handle: "leopardluxe", displayName: "Simone Roe", platform: "instagram", stage: "sourced",
    fit: { followerCount: 15000, engagementRate: 0.044, avgViews: 9000, geo: "US", niche: "fashion", nicheTags: ["leopard", "maximalist", "vintage"], aestheticScore: 74, fakeFollowerPct: 9 } },

  // --- Qualify / review (waiting on the operator) ---
  { handle: "scentandthecity", displayName: "Priya Anand", platform: "tiktok", stage: "review",
    fit: { followerCount: 120000, engagementRate: 0.048, avgViews: 96000, geo: "US", niche: "beauty", nicheTags: ["fragrance", "grwm", "beauty"], aestheticScore: 83, fakeFollowerPct: 5 } },
  { handle: "glossaryhour", displayName: "Tanya Brooks", platform: "instagram", stage: "review",
    fit: { followerCount: 26000, engagementRate: 0.039, avgViews: 12000, geo: "US", niche: "skincare", nicheTags: ["skincare", "makeup"], aestheticScore: 66, fakeFollowerPct: 12 } },
  // spam-risk example so the rationale/penalty is visible in-product
  { handle: "dealsdealsdeals99231", displayName: "Promo Central", platform: "tiktok", stage: "review",
    fit: { followerCount: 210000, engagementRate: 0.003, avgViews: 2000, geo: "US", niche: "lifestyle", nicheTags: ["deals"], aestheticScore: 22, fakeFollowerPct: 41 } },

  // --- Invite / contacted + replied ---
  { handle: "citrusandsmoke", displayName: "Lena Ortiz", platform: "tiktok", stage: "contacted",
    fit: { followerCount: 54000, engagementRate: 0.057, avgViews: 44000, geo: "US", niche: "fragrance", nicheTags: ["fragrance", "perfume"], aestheticScore: 80, fakeFollowerPct: 6 } },
  { handle: "highshinehabit", displayName: "Cass Nguyen", platform: "instagram", stage: "replied",
    fit: { followerCount: 33000, engagementRate: 0.049, avgViews: 21000, geo: "US", niche: "80s", nicheTags: ["80s", "retro", "maximalist"], aestheticScore: 77, fakeFollowerPct: 8 } },

  // --- Gift / onboarded (address in, ship pending) ---
  { handle: "jazzercisejane", displayName: "Robin Hale", platform: "tiktok", stage: "onboarded",
    fit: { followerCount: 61000, engagementRate: 0.055, avgViews: 50000, geo: "US", niche: "fitness", nicheTags: ["jazzercise", "workout", "80s"], aestheticScore: 79, fakeFollowerPct: 5 } },

  // --- Delivered / shipped ---
  { handle: "grapefeelings", displayName: "Ivy Marsh", platform: "instagram", stage: "shipped",
    fit: { followerCount: 47000, engagementRate: 0.05, avgViews: 30000, geo: "US", niche: "fragrance", nicheTags: ["fragrance", "beauty"], aestheticScore: 82, fakeFollowerPct: 6 } },

  // --- Content / posted ---
  { handle: "poweredinleopard", displayName: "Nadia Cruz", platform: "tiktok", stage: "posted",
    fit: { followerCount: 140000, engagementRate: 0.046, avgViews: 110000, geo: "US", niche: "fashion", nicheTags: ["leopard", "power", "maximalist"], aestheticScore: 85, fakeFollowerPct: 4 } },

  // --- Amplify / paid (high performer) ---
  { handle: "florallockerroom", displayName: "Gigi Sol", platform: "tiktok", stage: "paid",
    fit: { followerCount: 190000, engagementRate: 0.051, avgViews: 160000, geo: "US", niche: "fragrance", nicheTags: ["fragrance", "fitness", "dance"], aestheticScore: 88, fakeFollowerPct: 3 } },

  // --- Retain / customer advocate (first-party buyer) ---
  { handle: "everydaypulsefan", displayName: "Bex Cole", platform: "instagram", stage: "paid",
    source: "first_party",
    fit: { followerCount: 4200, engagementRate: 0.072, avgViews: 3000, geo: "US", niche: "beauty", nicheTags: ["beauty", "fragrance"], aestheticScore: 70, fakeFollowerPct: 2 } },
];

function guardOn(): boolean {
  try {
    return getEnv().MOCK === "1";
  } catch {
    return false;
  }
}

export async function POST() {
  if (!guardOn()) {
    return NextResponse.json({ error: "Seeding is only available in MOCK mode." }, { status: 403 });
  }

  await clearDemo();

  let inserted = 0;
  const idByHandle = new Map<string, string>();
  for (const s of SEED) {
    const fit = pulseFit(s.fit);
    const ring = suggestRing({ ...s.fit, source: s.source ?? null });
    const [row] = await db
      .insert(creators)
      .values({
        handle: s.handle,
        displayName: s.displayName,
        email: `${s.handle}@example.com`,
        source: s.source ?? "csv",
        primaryPlatform: s.platform,
        followerCount: s.fit.followerCount ?? null,
        engagementRate: s.fit.engagementRate ?? null,
        avgViews: s.fit.avgViews ?? null,
        fakeFollowerPct: s.fit.fakeFollowerPct ?? null,
        geo: s.fit.geo ?? null,
        niche: s.fit.niche ?? null,
        nicheTags: s.fit.nicheTags ?? null,
        aestheticScore: s.fit.aestheticScore ?? null,
        fitScore: fit.score,
        pulseFit: fit,
        ring,
        stage: s.stage,
        sourceMetadata: { ...DEMO_MARKER, importedAt: new Date().toISOString() },
      })
      .returning({ id: creators.id });
    idByHandle.set(s.handle, row.id);
    inserted++;
  }

  // A high performer with an affiliate code + attributed orders (fuels metrics).
  const gigiId = idByHandle.get("florallockerroom");
  let orders = 0;
  if (gigiId) {
    const code = "PULSE-GIGI-DEMO";
    const [aff] = await db
      .insert(affiliates)
      .values({ creatorId: gigiId, discountCode: code, status: "active", commissionPct: "10.00" })
      .returning({ id: affiliates.id });
    for (let i = 0; i < 6; i++) {
      await db.insert(ordersAttributed).values({
        shopifyOrderId: `demo-order-${i}`,
        affiliateId: aff.id,
        discountCode: code,
        subtotalCents: 5200 + i * 400,
        orderDate: new Date(Date.now() - i * 86_400_000),
      });
      orders++;
    }
  }

  // Content mentions: one reviewed, one awaiting review (drives the review count).
  const nadiaId = idByHandle.get("poweredinleopard");
  if (nadiaId) {
    await db.insert(contentMentions).values({
      creatorId: nadiaId,
      platform: "tiktok",
      postUrl: "https://www.tiktok.com/@poweredinleopard/video/demo1",
      postType: "tiktok",
      postedAt: new Date(Date.now() - 2 * 86_400_000),
      caption: "PULSE is the scent of a power workout #ad",
      metricsJson: { likes: 8200, comments: 140, views: 96000, decision: "amplify" },
    });
    await db.insert(contentMentions).values({
      creatorId: nadiaId,
      platform: "tiktok",
      postUrl: "https://www.tiktok.com/@poweredinleopard/video/demo2",
      postType: "tiktok",
      postedAt: new Date(Date.now() - 1 * 86_400_000),
      caption: "grape florals all day #pulse",
      metricsJson: { likes: 5100, comments: 90, views: 61000 }, // no decision → awaiting review
    });
  }

  // Two pending payouts so the "approve payments" NBA/bottleneck is visible.
  if (gigiId) {
    await db.insert(payouts).values({ creatorId: gigiId, half: "completion", amountUsd: 400, status: "pending" });
  }
  if (nadiaId) {
    await db.insert(payouts).values({ creatorId: nadiaId, half: "signing", amountUsd: 250, status: "pending" });
  }

  return NextResponse.json({ ok: true, inserted, orders });
}

export async function DELETE() {
  if (!guardOn()) {
    return NextResponse.json({ error: "Seeding is only available in MOCK mode." }, { status: 403 });
  }
  const removed = await clearDemo();
  return NextResponse.json({ ok: true, removed });
}

/**
 * Remove every demo-tagged creator. `affiliates` and `content_mentions` cascade
 * on creator delete, but `payouts` and `orders_attributed` do not, so those are
 * cleared first to avoid FK violations.
 */
async function clearDemo(): Promise<number> {
  const demo = await db
    .select({ id: creators.id })
    .from(creators)
    .where(sql`${creators.sourceMetadata}->>'demo' = 'true'`);
  const ids = demo.map((d) => d.id);
  await db.delete(ordersAttributed).where(like(ordersAttributed.shopifyOrderId, "demo-order-%"));
  if (ids.length) {
    await db.delete(payouts).where(inArray(payouts.creatorId, ids));
    await db.delete(creators).where(inArray(creators.id, ids));
  }
  return ids.length;
}
