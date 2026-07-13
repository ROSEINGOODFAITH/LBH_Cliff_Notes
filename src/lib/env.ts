import { z } from "zod";

/**
 * Server-only environment schema. NEVER import this into a client component.
 * Every value here is a secret or server config; none are NEXT_PUBLIC_.
 *
 * Optional integrations validate lazily so the app boots before every key exists.
 * Each feature checks `integrations.*()` and renders an empty state if its
 * integration is unconfigured — never a fake placeholder value.
 */
const envSchema = z.object({
  // ---- Core (required to boot) ----
  DATABASE_URL: z.string().url(),
  CLERK_SECRET_KEY: z.string().min(1),

  // ---- AI (required from P2) ----
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // ---- Shopify Admin ----
  SHOPIFY_STORE_DOMAIN: z.string().min(1).optional(),
  SHOPIFY_ADMIN_TOKEN: z.string().min(1).optional(),
  SHOPIFY_API_VERSION: z.string().default("2025-10"),

  // ---- Email: Gmail API for send + receive (P2) ----
  GMAIL_CLIENT_ID: z.string().min(1).optional(),
  GMAIL_CLIENT_SECRET: z.string().min(1).optional(),
  GMAIL_REFRESH_TOKEN: z.string().min(1).optional(),
  GMAIL_SENDER: z.string().email().optional(),

  // ---- Inngest background jobs (P2+) ----
  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),

  // ---- Tally onboarding webhook (P3) ----
  TALLY_SIGNING_SECRET: z.string().min(1).optional(),

  // ---- PULSE campaign module ----
  SMARTLEAD_API_KEY: z.string().min(1).optional(),
  SMARTLEAD_CAMPAIGN_TIER_A: z.string().min(1).optional(),
  SMARTLEAD_CAMPAIGN_TIER_B: z.string().min(1).optional(),
  SMARTLEAD_WEBHOOK_SECRET: z.string().min(1).optional(),
  PULSE_SEEDING_VARIANT_ID: z.string().min(1).optional(),
  TALLY_FORM_URL: z.string().url().optional(),
  CREATIVE_BRIEF_URL: z.string().url().optional(),
  MOCK: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (typeof window !== "undefined") {
    throw new Error("getEnv() is server-only and must not run in the browser.");
  }
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Is a given external integration fully configured? Drives empty states. */
export const integrations = {
  shopify(): boolean {
    const e = getEnv();
    return Boolean(e.SHOPIFY_STORE_DOMAIN && e.SHOPIFY_ADMIN_TOKEN);
  },
  anthropic(): boolean {
    return Boolean(getEnv().ANTHROPIC_API_KEY);
  },
  gmail(): boolean {
    const e = getEnv();
    return Boolean(e.GMAIL_CLIENT_ID && e.GMAIL_CLIENT_SECRET && e.GMAIL_REFRESH_TOKEN);
  },
  inngest(): boolean {
    const e = getEnv();
    return Boolean(e.INNGEST_EVENT_KEY && e.INNGEST_SIGNING_KEY);
  },
  tally(): boolean {
    return Boolean(getEnv().TALLY_SIGNING_SECRET);
  },
};
