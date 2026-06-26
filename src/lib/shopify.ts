import { getEnv } from "@/lib/env";

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
