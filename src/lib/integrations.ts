// PULSE module — one file, four thin clients. Each is ~a fetch wrapper; no SDKs needed.
// (DB access lives in `@/db` — the module's own drizzle client was dropped in favor of ours.)

export const MOCK = process.env.MOCK === "1";

const j = async (r: Response) => {
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`${r.url} ${r.status} ${body.slice(0, 300)}`); // keep the API's error code/message for diagnosis
  }
  return r.json();
};

/* ---------- Modash ---------- */
const MODASH = "https://api.modash.io/v1";
const modashHeaders = () => ({ Authorization: `Bearer ${process.env.MODASH_API_KEY}`, "Content-Type": "application/json" });

export async function modashSearch(page: number) {
  if (MOCK) return { users: mockUsers(30), total: 30 };
  return j(await fetch(`${MODASH}/tiktok/search`, {
    method: "POST", headers: modashHeaders(),
    body: JSON.stringify({
      page, sort: { field: "engagementRate", direction: "desc" },
      filter: {
        influencer: {
          followers: { min: 10_000, max: 500_000 },
          engagementRate: 0.03,
          location: [148838], // US
          hasContactDetails: [{ contactType: "email", filterAction: "must" }],
          relevance: ["#fragrance", "#perfumetok", "#beauty", "#grwm", "#skincare", "#unboxing"],
        },
      },
    }),
  }));
}

export async function modashReport(userId: string, platform: "tiktok" | "instagram" | "youtube" = "tiktok") {
  if (MOCK) return { profile: {} };
  return j(await fetch(`${MODASH}/${platform}/profile/${encodeURIComponent(userId)}/report`, { headers: modashHeaders() }));
}

/* ---------- Smartlead ---------- */
const SL = "https://server.smartlead.ai/api/v1";
const slKey = () => `api_key=${process.env.SMARTLEAD_API_KEY}`;

export async function smartleadPushLead(campaignId: string, lead: {
  email: string; first_name: string; custom_fields: Record<string, string>;
}) {
  if (MOCK) return { ok: true, mock: true };
  return j(await fetch(`${SL}/campaigns/${campaignId}/leads?${slKey()}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lead_list: [lead] }),
  }));
}

export async function smartleadReply(campaignId: string, leadEmail: string, body: string) {
  if (MOCK) return { ok: true, mock: true };
  return j(await fetch(`${SL}/campaigns/${campaignId}/reply-email-thread?${slKey()}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: leadEmail, reply_message_body: body }),
  }));
}

/* ---------- Shopify ---------- */
const SHOP = () => `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01`;
const shopHeaders = () => ({ "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN!, "Content-Type": "application/json" });

export async function shopifyCreateDiscount(code: string) {
  if (MOCK) return { id: "mock" };
  const pr = await j(await fetch(`${SHOP()}/price_rules.json`, {
    method: "POST", headers: shopHeaders(),
    body: JSON.stringify({ price_rule: {
      title: code, target_type: "line_item", target_selection: "all", allocation_method: "across",
      value_type: "percentage", value: "-15.0", customer_selection: "all", starts_at: new Date().toISOString(),
    }}),
  }));
  return j(await fetch(`${SHOP()}/price_rules/${pr.price_rule.id}/discount_codes.json`, {
    method: "POST", headers: shopHeaders(), body: JSON.stringify({ discount_code: { code } }),
  }));
}

// Gift seeding is a 100% "gift" — the creator pays nothing. We do this with an
// order-level applied_discount at 100% (percentage) rather than a $0 line item,
// so the line keeps the variant's real price and the order shows the gifted
// value for reporting. The discount carries a human-readable title/reason.
export const GIFT_DISCOUNT_TITLE = "LBH Creator Gift";
export const GIFT_DISCOUNT_DESCRIPTION = "Influencer seeding — 100% gifted";

// Deterministic per-creator reference stamped on tags + note_attributes. Shopify
// REST draft-order create has NO native idempotency key, so this is the durable
// external marker that lets us (and a human) detect/dedupe a re-created order.
export const giftIdempotencyKey = (creatorId: string) => `pulse-gift-${creatorId}`;

export interface GiftDraftOrderInput {
  variantId: string;
  shipping: Record<string, string>;
  creatorId: string;
  handle: string;
  tier?: string | null;
  note?: string;
}

// Pure builder (no I/O) so the payload shape is unit-testable without a network.
export function buildGiftDraftOrderPayload(input: GiftDraftOrderInput) {
  const key = giftIdempotencyKey(input.creatorId);
  const note = input.note ?? `PULSE seeding — @${input.handle} — Tier ${input.tier ?? "?"}`;
  return {
    draft_order: {
      line_items: [{ variant_id: Number(input.variantId), quantity: 1 }],
      // Order-level 100% discount → total is $0 while the line keeps full price.
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

export async function shopifyDraftOrder(input: GiftDraftOrderInput) {
  const payload = buildGiftDraftOrderPayload(input);
  if (MOCK) return { draft_order: { id: "mock-" + Date.now(), ...payload.draft_order } };
  return j(await fetch(`${SHOP()}/draft_orders.json`, {
    method: "POST", headers: shopHeaders(),
    body: JSON.stringify(payload),
  }));
}

export async function shopifyGetOrderFulfillment(draftOrderId: string) {
  if (MOCK) return null;
  const d = await j(await fetch(`${SHOP()}/draft_orders/${draftOrderId}.json`, { headers: shopHeaders() }));
  const orderId = d.draft_order?.order_id;
  if (!orderId) return null;
  const f = await j(await fetch(`${SHOP()}/orders/${orderId}/fulfillments.json`, { headers: shopHeaders() }));
  return f.fulfillments?.[0]?.tracking_number ?? null;
}

/* ---------- Claude ---------- */
export async function claude(prompt: string, maxTokens = 500): Promise<string> {
  if (MOCK) return JSON.stringify({ classification: "interested", aestheticScore: 70, firstLine: "Loved your latest layering video.", disclosureOk: true, reason: "mock" });
  const r = await j(await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  }));
  return r.content.map((b: any) => b.text ?? "").join("");
}

export const parseClaudeJson = (s: string) => JSON.parse(s.replace(/```json|```/g, "").trim());

/* ---------- Mock seed ---------- */
function mockUsers(n: number) {
  const niches = ["fragrance", "beauty", "lifestyle", "grwm", "fitness", "fashion", "skincare", "unboxing"];
  return Array.from({ length: n }, (_, i) => ({
    userId: "mock-" + Date.now() + "-" + i,
    profile: {
      username: "creator" + i, followers: Math.round(8000 + Math.random() ** 2 * 480000),
      engagementRate: 0.015 + Math.random() * 0.07, averageViews: 0,
      emails: ["creator" + i + "@example.com"], geo: "US",
      niche: niches[i % niches.length], fakeFollowerPct: Math.random() * 40,
    },
  })).map((u) => { u.profile.averageViews = Math.round(u.profile.followers * (0.05 + Math.random() * 0.8)); return u; });
}
