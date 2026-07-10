// PULSE module — one file, four thin clients. Each is ~a fetch wrapper; no SDKs needed.
// (DB access lives in `@/db` — the module's own drizzle client was dropped in favor of ours.)

export const MOCK = process.env.MOCK === "1";

const j = (r: Response) => { if (!r.ok) throw new Error(`${r.url} ${r.status}`); return r.json(); };

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

export async function modashReport(userId: string) {
  if (MOCK) return { profile: {} };
  return j(await fetch(`${MODASH}/tiktok/profile/${userId}/report`, { headers: modashHeaders() }));
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

export async function shopifyDraftOrder(variantId: string, shipping: Record<string, string>, note: string) {
  if (MOCK) return { draft_order: { id: "mock-" + Date.now() } };
  return j(await fetch(`${SHOP()}/draft_orders.json`, {
    method: "POST", headers: shopHeaders(),
    body: JSON.stringify({ draft_order: {
      line_items: [{ variant_id: Number(variantId), quantity: 1 }],
      shipping_address: shipping, note, tags: "pulse-seeding",
    }}),
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
