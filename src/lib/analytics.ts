import { sql } from "drizzle-orm";
import { db } from "@/db";
import { creators, ordersAttributed } from "@/db/schema";
import { funnelFromStages, type FunnelCounts as StageFunnel } from "@/lib/lifecycle";

export interface FunnelCounts extends StageFunnel {
  orders: number;
  revenueCents: number;
}

/**
 * Real funnel counts for the overview dashboard — no placeholders.
 *
 * The pipeline buckets derive from the canonical `creators.stage` (the live
 * PULSE workflow), NOT the legacy `creators.status`, which the PULSE flow never
 * updates. This keeps the overview dashboard consistent with the /pulse belt.
 * Orders + revenue come from attributed Shopify orders.
 */
export async function getFunnelCounts(): Promise<FunnelCounts> {
  const stageRows = await db
    .select({ stage: creators.stage, n: sql<number>`count(*)::int` })
    .from(creators)
    .groupBy(creators.stage);
  const [ord] = await db
    .select({
      n: sql<number>`count(*)::int`,
      rev: sql<number>`coalesce(sum(${ordersAttributed.subtotalCents}), 0)::int`,
    })
    .from(ordersAttributed);
  return {
    ...funnelFromStages(stageRows),
    orders: ord?.n ?? 0,
    revenueCents: ord?.rev ?? 0,
  };
}
