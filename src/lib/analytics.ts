import { sql } from "drizzle-orm";
import { db } from "@/db";
import { creators, contentMentions, ordersAttributed } from "@/db/schema";

export interface FunnelCounts {
  discovered: number;
  contacted: number;
  replied: number;
  active: number;
  posted: number;
  orders: number;
  revenueCents: number;
}

/** Real funnel counts for the overview dashboard — no placeholders. */
export async function getFunnelCounts(): Promise<FunnelCounts> {
  const [c] = await db
    .select({
      discovered: sql<number>`count(*)::int`,
      contacted: sql<number>`count(*) filter (where ${creators.status} in ('contacted','replied','negotiating','active'))::int`,
      replied: sql<number>`count(*) filter (where ${creators.status} in ('replied','negotiating','active'))::int`,
      active: sql<number>`count(*) filter (where ${creators.status} = 'active')::int`,
    })
    .from(creators);
  const [posted] = await db
    .select({ n: sql<number>`count(distinct ${contentMentions.creatorId})::int` })
    .from(contentMentions);
  const [ord] = await db
    .select({
      n: sql<number>`count(*)::int`,
      rev: sql<number>`coalesce(sum(${ordersAttributed.subtotalCents}), 0)::int`,
    })
    .from(ordersAttributed);
  return {
    discovered: c?.discovered ?? 0,
    contacted: c?.contacted ?? 0,
    replied: c?.replied ?? 0,
    active: c?.active ?? 0,
    posted: posted?.n ?? 0,
    orders: ord?.n ?? 0,
    revenueCents: ord?.rev ?? 0,
  };
}
