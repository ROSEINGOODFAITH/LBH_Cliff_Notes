import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { creators, affiliates, ordersAttributed, events } from "@/db/schema";
import { brandConfig } from "@/lib/brand";
import { createDiscountCode, getRecentOrders, shopifyConfigured } from "@/lib/shopify";
import { insertCreatorIfNew, type Platform } from "@/lib/creators";

export type AffiliateRow = typeof affiliates.$inferSelect;

const DEFAULT_COMMISSION = 15;

function baseCode(handle: string, pct: number): string {
  const cleaned = handle.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 12) || "CREATOR";
  return `${cleaned}${Math.round(pct)}`;
}

async function uniqueCode(base: string): Promise<string> {
  let code = base;
  for (let i = 0; i < 50; i++) {
    const exists = await db.select({ id: affiliates.id }).from(affiliates).where(eq(affiliates.discountCode, code)).limit(1);
    if (!exists[0]) return code;
    code = `${base}${i + 2}`;
  }
  return `${base}${Date.now().toString().slice(-4)}`;
}

/* -------------------------------- Signup ---------------------------------- */
export interface SignupInput {
  handle: string;
  email?: string | null;
  displayName?: string | null;
  platform?: Platform | null;
  commissionPct?: number;
}
export interface SignupResult {
  ok: boolean;
  message: string;
  affiliateId?: string;
  code?: string;
}

export async function createAffiliateFromSignup(input: SignupInput): Promise<SignupResult> {
  const handle = input.handle.replace(/^@/, "").trim();
  if (!handle) return { ok: false, message: "A social handle is required." };
  const pct = input.commissionPct ?? DEFAULT_COMMISSION;

  const { creator } = await insertCreatorIfNew({
    handle,
    email: input.email ?? null,
    displayName: input.displayName ?? null,
    primaryPlatform: input.platform ?? null,
    source: "first_party",
    status: "prospect",
    notes: "Self-signed-up via /join",
  });

  const existing = await db.select().from(affiliates).where(eq(affiliates.creatorId, creator.id)).limit(1);
  if (existing[0]) {
    return {
      ok: true,
      message: `You're already signed up — your code is ${existing[0].discountCode}.`,
      affiliateId: existing[0].id,
      code: existing[0].discountCode,
    };
  }

  const code = await uniqueCode(baseCode(handle, pct));
  const [row] = await db
    .insert(affiliates)
    .values({
      creatorId: creator.id,
      discountCode: code,
      commissionPct: String(pct),
      status: "pending",
      signedUpAt: new Date(),
      affiliateLink: `https://${brandConfig.brandDomain}/?ref=${encodeURIComponent(code)}`,
    })
    .returning();
  await db.insert(events).values({ creatorId: creator.id, type: "affiliate.signup", payload: { code } });
  return { ok: true, message: `Thanks! Your code ${code} is reserved and will be activated shortly.`, affiliateId: row.id, code };
}

/* ------------------------------- Activation -------------------------------- */
export async function activateAffiliate(affiliateId: string): Promise<{ ok: boolean; message: string }> {
  const aff = (await db.select().from(affiliates).where(eq(affiliates.id, affiliateId)).limit(1))[0];
  if (!aff) return { ok: false, message: "Affiliate not found." };
  if (aff.status === "active" && aff.shopifyDiscountId) return { ok: true, message: `Already active (${aff.discountCode}).` };
  if (!shopifyConfigured())
    return { ok: false, message: "Shopify isn't configured — add SHOPIFY_ADMIN_TOKEN + SHOPIFY_STORE_DOMAIN." };

  const pct = Number(aff.commissionPct ?? DEFAULT_COMMISSION);
  try {
    const disc = await createDiscountCode({
      code: aff.discountCode,
      title: `Creator affiliate ${aff.discountCode}`,
      percentage: Math.max(0, Math.min(1, pct / 100)),
    });
    await db.update(affiliates).set({ status: "active", shopifyDiscountId: disc.id }).where(eq(affiliates.id, affiliateId));
    await db.update(creators).set({ status: "active" }).where(eq(creators.id, aff.creatorId));
    await db.insert(events).values({
      creatorId: aff.creatorId,
      type: "affiliate.activated",
      payload: { code: aff.discountCode, shopifyDiscountId: disc.id },
    });
    return { ok: true, message: `Activated ${aff.discountCode} in Shopify.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Activation failed." };
  }
}

/* ----------------------------- Order attribution --------------------------- */
export interface OrderSyncResult {
  ok: boolean;
  message: string;
  attributed: number;
}
export async function syncAttributedOrders(): Promise<OrderSyncResult> {
  if (!shopifyConfigured()) return { ok: false, message: "Shopify isn't configured.", attributed: 0 };
  const affs = await db.select().from(affiliates);
  const byCode = new Map<string, AffiliateRow>();
  for (const a of affs) if (a.discountCode) byCode.set(a.discountCode.toLowerCase(), a);
  if (byCode.size === 0) return { ok: true, message: "No affiliate codes yet.", attributed: 0 };

  let attributed = 0;
  const orders = await getRecentOrders(250);
  for (const o of orders) {
    for (const codeUsed of o.discountCodes) {
      const aff = byCode.get(codeUsed.toLowerCase());
      if (!aff) continue;
      const inserted = await db
        .insert(ordersAttributed)
        .values({
          shopifyOrderId: String(o.id),
          affiliateId: aff.id,
          discountCode: codeUsed,
          subtotalCents: o.subtotalCents,
          currency: o.currency ?? "USD",
          orderDate: o.createdAt ? new Date(o.createdAt) : null,
        })
        .onConflictDoNothing({ target: ordersAttributed.shopifyOrderId })
        .returning({ id: ordersAttributed.id });
      if (inserted[0]) {
        attributed++;
        await db.insert(events).values({
          creatorId: aff.creatorId,
          type: "order.attributed",
          payload: { shopifyOrderId: String(o.id), code: codeUsed },
        });
      }
      break; // one attribution per order
    }
  }
  return { ok: true, message: `Attributed ${attributed} new order(s).`, attributed };
}

/* ------------------------------ Performance -------------------------------- */
export interface AffiliatePerf {
  affiliate: AffiliateRow;
  handle: string;
  email: string | null;
  orders: number;
  revenueCents: number;
  aovCents: number | null;
}

export async function listAffiliatesWithPerf(): Promise<AffiliatePerf[]> {
  const rows = await db
    .select({ affiliate: affiliates, handle: creators.handle, email: creators.email })
    .from(affiliates)
    .innerJoin(creators, eq(affiliates.creatorId, creators.id))
    .orderBy(desc(affiliates.createdAt))
    .limit(200);
  if (rows.length === 0) return [];

  const agg = await db
    .select({
      affiliateId: ordersAttributed.affiliateId,
      orders: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${ordersAttributed.subtotalCents}), 0)::int`,
    })
    .from(ordersAttributed)
    .groupBy(ordersAttributed.affiliateId);
  const byAff = new Map<string, { orders: number; revenue: number }>();
  for (const a of agg) if (a.affiliateId) byAff.set(a.affiliateId, { orders: a.orders, revenue: a.revenue });

  return rows.map((r) => {
    const p = byAff.get(r.affiliate.id) ?? { orders: 0, revenue: 0 };
    return {
      affiliate: r.affiliate,
      handle: r.handle,
      email: r.email,
      orders: p.orders,
      revenueCents: p.revenue,
      aovCents: p.orders ? Math.round(p.revenue / p.orders) : null,
    };
  });
}
