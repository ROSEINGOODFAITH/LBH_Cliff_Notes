import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { provisioningClaims } from "@/db/schema";

/**
 * Database-level mutual exclusion for gift provisioning (see the
 * `provisioning_claims` table in db/schema.ts). This is the authoritative guard
 * against double-shipping a gift when Inngest redelivers an event or two workers
 * race: the winner atomically owns the claim row before ANY Shopify side effect;
 * losers get `null` and must abort. The Shopify `note_attributes`/tags marker is
 * kept only as defense-in-depth.
 */

/** Deterministic per-creator gift key. Mirrors the Shopify idempotency marker. */
export const giftKeyFor = (creatorId: string): string => `pulse-gift-${creatorId}`;

export type ProvisioningClaim = typeof provisioningClaims.$inferSelect;

/**
 * Atomically claim gift provisioning for a creator. Returns the owned claim row
 * if THIS caller won (fresh claim, or reviving a previously `failed` one), or
 * `null` if another worker already holds an active/`completed` claim.
 *
 * Implemented as a single `INSERT … ON CONFLICT DO UPDATE … WHERE status =
 * 'failed' RETURNING`: Postgres returns a row only when the row was actually
 * inserted or updated, so a `claimed`/`completed` conflict yields zero rows —
 * exactly one winner, retries resume safely, completed work is never redone.
 */
/**
 * The atomic claim statement: a single `INSERT … ON CONFLICT (creator_id,
 * gift_key) DO UPDATE … WHERE status = 'failed' RETURNING`. Exposed so its shape
 * (the guard that makes Postgres pick exactly one winner) is unit-testable
 * without a live database. Postgres serializes concurrent inserts on the unique
 * index, so only the winning statement returns a row.
 */
export function buildClaimStatement(creatorId: string, giftKey: string) {
  return db
    .insert(provisioningClaims)
    .values({ creatorId, giftKey, status: "claimed" })
    .onConflictDoUpdate({
      target: [provisioningClaims.creatorId, provisioningClaims.giftKey],
      set: {
        status: "claimed",
        attempts: sql`${provisioningClaims.attempts} + 1`,
        lastError: null,
        updatedAt: new Date(),
      },
      setWhere: eq(provisioningClaims.status, "failed"),
    })
    .returning();
}

export async function claimGift(
  creatorId: string,
  giftKey: string = giftKeyFor(creatorId),
): Promise<ProvisioningClaim | null> {
  const rows = await buildClaimStatement(creatorId, giftKey);
  return rows[0] ?? null;
}

/** Mark a won claim complete with the Shopify result ids. Terminal state. */
export async function completeGift(
  claimId: string,
  result: { draftOrderId?: string | null; discountCode?: string | null },
): Promise<void> {
  await db
    .update(provisioningClaims)
    .set({
      status: "completed",
      draftOrderId: result.draftOrderId ?? null,
      discountCode: result.discountCode ?? null,
      completedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(provisioningClaims.id, claimId));
}

/** Release a won claim back to `failed` so a later redelivery can retry it. */
export async function failGift(claimId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(provisioningClaims)
    .set({ status: "failed", lastError: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(provisioningClaims.id, claimId));
}
