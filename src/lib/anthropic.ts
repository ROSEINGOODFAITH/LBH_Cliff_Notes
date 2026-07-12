import { getEnv, integrations } from "@/lib/env";
import { brandConfig } from "@/lib/brand";

/**
 * Anthropic Claude client (raw fetch, no SDK dependency). Used for outreach
 * generation and reply classification. Retry/backoff; graceful not-configured.
 */
const BASE = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const MODELS = {
  draft: "claude-sonnet-4-6",
  classify: "claude-haiku-4-5-20251001",
} as const;

export class AnthropicError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = "AnthropicError";
    this.status = status;
    this.body = body;
  }
}
export class AnthropicNotConfiguredError extends AnthropicError {
  constructor() {
    super("Anthropic is not configured. Set ANTHROPIC_API_KEY.");
    this.name = "AnthropicNotConfiguredError";
  }
}

export function anthropicConfigured(): boolean {
  try {
    return integrations.anthropic();
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callClaude(
  opts: { model: string; system: string; user: string; maxTokens: number },
  { retries = 3, baseDelayMs = 600 }: { retries?: number; baseDelayMs?: number } = {},
): Promise<string> {
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) throw new AnthropicNotConfiguredError();

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(BASE, {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
      }),
      cache: "no-store",
    });

    if (res.status !== 429 && res.status < 500) {
      const text = await res.text();
      if (!res.ok) throw new AnthropicError(`Anthropic ${res.status}`, res.status, text.slice(0, 500));
      const json = JSON.parse(text);
      const out = Array.isArray(json.content)
        ? json.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n")
        : "";
      return out;
    }
    if (attempt >= retries) {
      const text = await res.text();
      throw new AnthropicError(`Anthropic ${res.status} (retries exhausted)`, res.status, text.slice(0, 500));
    }
    const ra = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(ra) && ra > 0 ? ra * 1000 : baseDelayMs * 2 ** attempt + Math.random() * 250;
    await sleep(delay);
    attempt += 1;
  }
}

/** Pull the first JSON object out of a model response, tolerating prose/fences. */
function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new AnthropicError("No JSON found in model output");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

/* ------------------------------- Generation -------------------------------- */
export interface OutreachContext {
  creator: {
    handle: string;
    displayName?: string | null;
    platform?: string | null;
    followerCount?: number | null;
    nicheTags?: string[] | null;
    notes?: string | null;
  };
  campaign?: { name: string; objective: string; productSkus?: string[] | null } | null;
  senderName?: string;
  /** Optional campaign brief + this creator's angle (PULSE context-aware drafting). */
  brief?: { product: string; oneLiner: string; artDirection: string } | null;
  angleHook?: string | null;
}
export interface OutreachDraft {
  subject: string;
  body: string;
}

export async function generateOutreach(ctx: OutreachContext): Promise<OutreachDraft> {
  const v = brandConfig.brandVoice;
  const system = [
    `You write 1:1 influencer outreach emails for ${brandConfig.brandName}, a DTC fragrance and body-care brand (${brandConfig.brandDomain}).`,
    `Brand voice: ${v.tone}. Avoid: ${v.avoid.join(", ")}. ${v.notes}`,
    `Rules: This is a first-touch, personal email — never mass-blast. Reference the creator's actual niche/content where given. Do NOT invent metrics, stats, follower counts, or specifics you weren't given. Keep it concise (90-160 words). One clear, low-pressure ask aligned to the campaign objective. Sign off as ${ctx.senderName ?? "the " + brandConfig.brandName + " team"}.`,
    `Return ONLY JSON: {"subject": string, "body": string}. The body is plain text with real line breaks, no markdown.`,
  ].join("\n");

  const c = ctx.creator;
  const userLines = [
    `Creator handle: @${c.handle}`,
    c.displayName ? `Name: ${c.displayName}` : null,
    c.platform ? `Platform: ${c.platform}` : null,
    c.nicheTags?.length ? `Niches: ${c.nicheTags.join(", ")}` : null,
    typeof c.followerCount === "number" ? `Followers: ${c.followerCount}` : null,
    c.notes ? `Notes: ${c.notes}` : null,
    ctx.campaign
      ? `Campaign: ${ctx.campaign.name} (objective: ${ctx.campaign.objective}${ctx.campaign.productSkus?.length ? `, products: ${ctx.campaign.productSkus.join(", ")}` : ""})`
      : `No specific campaign — general partnership interest.`,
    ctx.brief ? `Product brief: ${ctx.brief.product} — ${ctx.brief.oneLiner}. Art direction: ${ctx.brief.artDirection}` : null,
    ctx.angleHook ? `Lead angle for this creator: ${ctx.angleHook}` : null,
    ctx.brief
      ? `Offer: a no-obligation invitation to a small product-testing group. Do NOT promise payment, require a post, or mention affiliate quotas in this first touch.`
      : null,
  ].filter(Boolean);

  const raw = await callClaude({ model: MODELS.draft, system, user: userLines.join("\n"), maxTokens: 1024 });
  const parsed = extractJson<{ subject?: string; body?: string }>(raw);
  if (!parsed.subject || !parsed.body) throw new AnthropicError("Model did not return subject/body");
  return { subject: parsed.subject.trim(), body: parsed.body.trim() };
}

/* ------------------------------ Classification ----------------------------- */
export type InterestLabel = "interested" | "maybe" | "not_interested" | "needs_follow_up" | "ooo";
const LABELS: InterestLabel[] = ["interested", "maybe", "not_interested", "needs_follow_up", "ooo"];

export interface Classification {
  label: InterestLabel;
  rationale: string;
}

export async function classifyReply(replyText: string): Promise<Classification> {
  const system = [
    `Classify an influencer's email reply to a brand outreach into exactly one label:`,
    `- "interested": clearly wants to move forward / asks about next steps, rates, products.`,
    `- "maybe": warm but noncommittal, conditional, or asking general questions.`,
    `- "not_interested": declines or unsubscribes.`,
    `- "needs_follow_up": ambiguous or asks to be contacted later.`,
    `- "ooo": auto-reply / out-of-office / away message.`,
    `Return ONLY JSON: {"label": one-of-the-labels, "rationale": short string}.`,
  ].join("\n");
  const raw = await callClaude({ model: MODELS.classify, system, user: replyText.slice(0, 4000), maxTokens: 256 });
  const parsed = extractJson<{ label?: string; rationale?: string }>(raw);
  const label = (LABELS as string[]).includes(parsed.label ?? "") ? (parsed.label as InterestLabel) : "needs_follow_up";
  return { label, rationale: parsed.rationale?.trim() ?? "" };
}
