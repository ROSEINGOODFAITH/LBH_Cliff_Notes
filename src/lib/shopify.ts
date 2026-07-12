import { getEnv, integrations } from "@/lib/env";

/**
 * Shopify Admin API client with retry + exponential backoff and 429 Retry-After
 * handling. Every external call in the app must go through a wrapper like this
 * (guardrail §7). Reads only here in P0; discount-code mutations land in P3.
 */

export class ShopifyError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = "ShopifyError";
    this.status = status;
    this.body = body;
  }
}

export class ShopifyNotConfiguredError extends ShopifyError {
  constructor() {
    super("Shopify is not configured. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN.");
    this.name = "ShopifyNotConfiguredError";
  }
}

interface RetryOpts {
  retries?: number;
  baseDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<Response>, { retries = 4, baseDelayMs = 500 }: RetryOpts = {}): Promise<Response> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fn();
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt >= retries) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 200);
    await sleep(delay);
    attempt += 1;
  }
}

function adminBase() {
  const env = getEnv();
  if (!env.SHOPIFY_STORE_DOMAIN || !env.SHOPIFY_ADMIN_TOKEN) throw new ShopifyNotConfiguredError();
  return {
    token: env.SHOPIFY_ADMIN_TOKEN,
    rest: `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}`,
    graphql: `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
  };
}

/** Low-level REST call against the Admin API. */
export async function shopifyRest<T = unknown>(
  path: string,
  init: RequestInit = {},
  retry?: RetryOpts,
): Promise<T> {
  const { token, rest } = adminBase();
  const res = await withRetry(
    () =>
      fetch(`${rest}${path}`, {
        ...init,
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
        cache: "no-store",
      }),
    retry,
  );
  const text = await res.text();
  if (!res.ok) throw new ShopifyError(`Shopify REST ${res.status}`, res.status, text.slice(0, 500));
  return (text ? JSON.parse(text) : null) as T;
}

/** Low-level GraphQL Admin call (used for discount codes in P3). */
export async function shopifyGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  retry?: RetryOpts,
): Promise<T> {
  const { token, graphql } = adminBase();
  const res = await withRetry(
    () =>
      fetch(graphql, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
      }),
    retry,
  );
  const text = await res.text();
  if (!res.ok) throw new ShopifyError(`Shopify GraphQL ${res.status}`, res.status, text.slice(0, 500));
  const json = JSON.parse(text);
  if (json.errors) throw new ShopifyError("Shopify GraphQL errors", res.status, JSON.stringify(json.errors));
  return json.data as T;
}

export interface ShopifyOrderSummary {
  id: number;
  name: string;
  createdAt: string | null;
  subtotalCents: number | null;
  currency: string | null;
  discountCodes: string[];
}

/** Read recent orders — used by the P0 Shopify ping to prove the connection. */
export async function getRecentOrders(limit = 1): Promise<ShopifyOrderSummary[]> {
  const data = await shopifyRest<{ orders: ShopifyRawOrder[] }>(
    `/orders.json?status=any&limit=${limit}&fields=id,name,created_at,subtotal_price,currency,discount_codes`,
  );
  return (data.orders ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    createdAt: o.created_at ?? null,
    subtotalCents: o.subtotal_price != null ? Math.round(parseFloat(o.subtotal_price) * 100) : null,
    currency: o.currency ?? null,
    discountCodes: (o.discount_codes ?? []).map((d) => d.code),
  }));
}

interface ShopifyRawOrder {
  id: number;
  name: string;
  created_at?: string;
  subtotal_price?: string;
  currency?: string;
  discount_codes?: { code: string }[];
}

export function shopifyConfigured(): boolean {
  try {
    return integrations.shopify();
  } catch {
    return false;
  }
}

/** Local/test guard — when set, every Shopify write returns a mock, no network. */
function isMock(): boolean {
  try {
    return getEnv().MOCK === "1";
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * PULSE gift seeding — the single Admin path for gift draft orders, the
 * creator seeding discount code, and fulfillment tracking. Previously duplicated
 * in lib/integrations.ts against a hardcoded API version with its own fetch/auth
 * /error handling; consolidated here so there is one client, one version
 * (SHOPIFY_API_VERSION), one retry/error surface (ShopifyError), and one MOCK
 * short-circuit for local/test.
 * ------------------------------------------------------------------------- */

// Gift seeding is a 100% "gift" — the creator pays nothing. Modeled as an
// order-level applied_discount at 100% (percentage) rather than a $0 line item,
// so the line keeps the variant's real price and the order shows the gifted
// value for reporting.
export const GIFT_DISCOUNT_TITLE = "LBH Creator Gift";
export const GIFT_DISCOUNT_DESCRIPTION = "Influencer seeding — 100% gifted";

// Deterministic per-creator reference stamped on tags + note_attributes. Shopify
// REST draft-order create has NO native idempotency key, so this is the durable
// external marker (defense-in-depth alongside the provisioning_claims table).
export const giftIdempotencyKey = (creatorId: string) => `pulse-gift-${creatorId}`;

export interface GiftDraftOrderInput {
  variantId: string;
  shipping: Record<string, string>;
  creatorId: string;
  handle: string;
  tier?: string | null;
  note?: string;
}

export interface DraftOrderResult {
  draft_order: { id: string | number; [k: string]: unknown };
}

// Pure builder (no I/O) so the payload shape is unit-testable without a network.
export function buildGiftDraftOrderPayload(input: GiftDraftOrderInput) {
  const key = giftIdempotencyKey(input.creatorId);
  const note = input.note ?? `PULSE seeding — @${input.handle} — Tier ${input.tier ?? "?"}`;
  return {
    draft_order: {
      line_items: [{ variant_id: Number(input.variantId), quantity: 1 }],
      applied_discount: {
        title: GIFT_DISCOUNT_TITLE,
        description: GIFT_DISCOUNT_DESCRIPTION,
        value_type: "percentage",
        value: "100.0",
      },
      shipping_address: input.shipping,
      note,
      tags: `pulse-seeding, ${key}`,
      note_attributes: [
        { name: "pulse_creator_id", value: input.creatorId },
        { name: "pulse_idempotency_key", value: key },
        { name: "pulse_reason", value: GIFT_DISCOUNT_DESCRIPTION },
      ],
    },
  };
}

/** Create the 100%-gifted draft order for a creator. MOCK → in-memory result. */
export async function createGiftDraftOrder(input: GiftDraftOrderInput): Promise<DraftOrderResult> {
  const payload = buildGiftDraftOrderPayload(input);
  if (isMock()) {
    return { draft_order: { id: "mock-" + Date.now(), ...payload.draft_order } };
  }
  return shopifyRest<DraftOrderResult>("/draft_orders.json", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Mint the creator's -15% seeding discount code. MOCK → in-memory result. */
export async function createSeedingDiscountCode(code: string): Promise<{ id: string }> {
  if (isMock()) return { id: "mock" };
  const pr = await shopifyRest<{ price_rule: { id: number } }>("/price_rules.json", {
    method: "POST",
    body: JSON.stringify({
      price_rule: {
        title: code,
        target_type: "line_item",
        target_selection: "all",
        allocation_method: "across",
        value_type: "percentage",
        value: "-15.0",
        customer_selection: "all",
        starts_at: new Date().toISOString(),
      },
    }),
  });
  const dc = await shopifyRest<{ discount_code: { id: number } }>(
    `/price_rules/${pr.price_rule.id}/discount_codes.json`,
    { method: "POST", body: JSON.stringify({ discount_code: { code } }) },
  );
  return { id: String(dc.discount_code.id) };
}

/** Tracking number for a gift draft order once fulfilled, else null. */
export async function getGiftFulfillmentTracking(draftOrderId: string): Promise<string | null> {
  if (isMock()) return null;
  const d = await shopifyRest<{ draft_order?: { order_id?: number | null } }>(
    `/draft_orders/${draftOrderId}.json`,
  );
  const orderId = d.draft_order?.order_id;
  if (!orderId) return null;
  const f = await shopifyRest<{ fulfillments?: { tracking_number?: string | null }[] }>(
    `/orders/${orderId}/fulfillments.json`,
  );
  return f.fulfillments?.[0]?.tracking_number ?? null;
}

/** Create a unique code-based percentage discount (P3). percentage is 0..1. */
export interface DiscountResult {
  id: string;
}
export async function createDiscountCode(opts: {
  code: string;
  title: string;
  percentage: number;
}): Promise<DiscountResult> {
  const mutation = `mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;
  const variables = {
    basicCodeDiscount: {
      title: opts.title,
      code: opts.code,
      startsAt: new Date().toISOString(),
      customerSelection: { all: true },
      customerGets: { value: { percentage: opts.percentage }, items: { all: true } },
      appliesOncePerCustomer: false,
    },
  };
  const data = await shopifyGraphQL<{
    discountCodeBasicCreate: {
      codeDiscountNode: { id: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(mutation, variables);
  const res = data.discountCodeBasicCreate;
  if (res.userErrors?.length) {
    throw new ShopifyError(`Discount create failed: ${res.userErrors.map((e) => e.message).join("; ")}`);
  }
  if (!res.codeDiscountNode) throw new ShopifyError("Discount create returned no node");
  return { id: res.codeDiscountNode.id };
}
