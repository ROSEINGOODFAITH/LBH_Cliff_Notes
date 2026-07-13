/**
 * Creator relationship tier — COLD / WARM / FAM.
 *
 * This is RELATIONSHIP STRENGTH: how well the brand already knows a creator. It
 * is deliberately SEPARATE from two other axes and must never be conflated with
 * either:
 *   - `creators.stage` (see lib/lifecycle.ts) — where the creator is in the
 *     canonical funnel. The tier never sets, defaults, or mutates the stage.
 *   - `creators.ring` (see lib/pulse-rings.ts) — the campaign JOB a creator does
 *     (Signal / Editorial / Advocate). A creator can have a tier AND a ring.
 *
 * The tier only ever influences *suggestions* (recommended next action). The
 * operator always confirms; nothing here moves the lifecycle on its own.
 */

export type RelationshipTier = "COLD" | "WARM" | "FAM";

export const RELATIONSHIP_TIERS: RelationshipTier[] = ["COLD", "WARM", "FAM"];

/** The safe default for a brand-new record with no known history. */
export const DEFAULT_RELATIONSHIP_TIER: RelationshipTier = "COLD";

export type RelationshipTone = "neutral" | "active" | "done";

export interface RelationshipMeta {
  key: RelationshipTier;
  label: string;
  /** One-line operator explanation. */
  description: string;
  tone: RelationshipTone;
}

export const RELATIONSHIP_META: Record<RelationshipTier, RelationshipMeta> = {
  COLD: {
    key: "COLD",
    label: "Cold",
    description: "New prospect — no established relationship yet.",
    tone: "neutral",
  },
  WARM: {
    key: "WARM",
    label: "Warm",
    description: "Known or previously engaged contact.",
    tone: "active",
  },
  FAM: {
    key: "FAM",
    label: "Fam",
    description: "Recurring, high-trust creator the brand works with often.",
    tone: "done",
  },
};

export function isRelationshipTier(v: unknown): v is RelationshipTier {
  return typeof v === "string" && (RELATIONSHIP_TIERS as string[]).includes(v);
}

/**
 * Coerce arbitrary input to a valid tier, tolerating case/whitespace. Returns
 * null for anything unrecognized (never guesses a tier from other signals).
 */
export function coerceRelationshipTier(v: unknown): RelationshipTier | null {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase();
  return isRelationshipTier(up) ? (up as RelationshipTier) : null;
}

export function relationshipMeta(key: string | null | undefined): RelationshipMeta | null {
  if (!key) return null;
  const up = key.toUpperCase();
  return isRelationshipTier(up) ? RELATIONSHIP_META[up as RelationshipTier] : null;
}
