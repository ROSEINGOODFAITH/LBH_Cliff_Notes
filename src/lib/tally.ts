import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creators } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { insertCreatorIfNew, type CreatorRow } from "@/lib/creators";

/** Thrown when the webhook is hit but TALLY_SIGNING_SECRET isn't configured. */
export class TallyNotConfiguredError extends Error {
  constructor() {
    super("Tally webhook is not configured (TALLY_SIGNING_SECRET missing).");
    this.name = "TallyNotConfiguredError";
  }
}

/** Minimal shape of a Tally webhook payload — only the parts we consume. */
interface TallyField {
  key: string;
  label: string;
  type: string;
  value: unknown;
}
export interface TallyWebhookPayload {
  eventId?: string;
  eventType?: string;
  data?: { fields?: TallyField[]; [k: string]: unknown };
}

/**
 * Flatten `data.fields[]` into a label-keyed accessor so callers can read
 * `f["instagram handle"]`. Keys are trimmed + lowercased; array values
 * (multi-select) are joined with ", "; blank/absent values become null.
 */
export function flattenTallyFields(payload: TallyWebhookPayload): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of payload.data?.fields ?? []) {
    if (!field?.label) continue;
    out[field.label.trim().toLowerCase()] = normalizeValue(field.value);
  }
  return out;
}

function normalizeValue(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const parts = value.map((v) => (v == null ? "" : String(v))).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  const s = String(value).trim();
  return s.length ? s : null;
}

/**
 * Verify Tally's `Tally-Signature` header: base64 HMAC-SHA256 of the raw
 * request body keyed by TALLY_SIGNING_SECRET. Throws if unconfigured so the
 * route can respond 503 rather than silently accepting unsigned traffic.
 */
export function verifyTallySignature(rawBody: string, signature: string | null): boolean {
  const secret = getEnv().TALLY_SIGNING_SECRET;
  if (!secret) throw new TallyNotConfiguredError();
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface TallyOnboardData {
  email: string | null;
  igHandle: string | null;
  displayName: string | null;
}

/** Strip an IG profile URL / leading @ / whitespace down to a bare handle. */
function normalizeIgHandle(raw: string | null): string | null {
  if (!raw) return null;
  const h = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/\/+$/, "")
    .replace(/^@+/, "")
    .trim();
  return h.length ? h : null;
}

/**
 * Onboard a creator from a Tally submission. Deduped via insertCreatorIfNew
 * (by handle + platform). Source is "first_party" — Tally is not a distinct
 * creator_source enum value, and a self-submitted form is first-party data.
 * If we match an existing row that has no ig_handle yet, we backfill it.
 */
export async function onboardTally(
  data: TallyOnboardData,
): Promise<{ creator: CreatorRow; created: boolean }> {
  const igHandle = normalizeIgHandle(data.igHandle);
  const email = data.email?.trim() || null;
  // `handle` is NOT NULL — prefer the IG handle, fall back to the email
  // local-part so we never try to insert an empty identifier.
  const handle = igHandle ?? (email ? email.split("@")[0] : null);
  if (!handle) {
    throw new Error("Tally submission has no Instagram handle or email to identify the creator.");
  }

  const result = await insertCreatorIfNew({
    handle,
    displayName: data.displayName,
    email,
    igHandle,
    primaryPlatform: "instagram",
    source: "first_party",
    status: "prospect",
  });

  if (!result.created && igHandle && !result.creator.igHandle) {
    const [updated] = await db
      .update(creators)
      .set({ igHandle })
      .where(eq(creators.id, result.creator.id))
      .returning();
    return { creator: updated ?? result.creator, created: false };
  }
  return result;
}
