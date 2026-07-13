// PULSE module — thin API clients. Each is ~a fetch wrapper; no SDKs needed.
// (DB access lives in `@/db` — the module's own drizzle client was dropped in favor of ours.)

export const MOCK = process.env.MOCK === "1";

const j = async (r: Response) => {
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`${r.url} ${r.status} ${body.slice(0, 300)}`); // keep the API's error code/message for diagnosis
  }
  return r.json();
};

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

// NOTE: Shopify gift/discount/fulfillment operations now live in the single
// typed Admin client at `@/lib/shopify` (createGiftDraftOrder,
// createSeedingDiscountCode, getGiftFulfillmentTracking, buildGiftDraftOrderPayload).

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
