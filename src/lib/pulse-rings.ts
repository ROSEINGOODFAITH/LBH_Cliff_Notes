/**
 * PULSE creator rings — three operational cohorts inside the one campaign. Rings
 * describe the JOB a creator does for the launch; they are orthogonal to the
 * canonical `creators.stage` (a creator has both a stage and, optionally, a
 * ring). Ring assignment is human-editable and stored on `creators.ring`.
 */
import type { FitInput } from "@/lib/pulse-fit";

export type RingKey = "signal" | "editorial" | "advocate";

export type Ring = {
  key: RingKey;
  label: string;
  /** What this ring is FOR — shown in-product so the operator knows the job. */
  job: string;
  /** The recommended next move for a creator in this ring. */
  nextAction: string;
  /** Rough audience band this ring targets (guidance, not a hard rule). */
  audienceHint: string;
};

export const RINGS: Ring[] = [
  {
    key: "signal",
    label: "Signal Creators",
    job: "Larger, culturally-resonant voices who set the tone and make PULSE feel like it's everywhere at launch.",
    nextAction: "Curate a paid, disclosed review after genuine fit and interest are confirmed.",
    audienceHint: "100k+ followers",
  },
  {
    key: "editorial",
    label: "Editorial Micro-Creators",
    job: "High-craft micro-creators whose original, on-aesthetic content becomes reusable brand creative.",
    nextAction: "Gift the sample, then request permission to license the best posts as ads.",
    audienceHint: "10k–100k followers",
  },
  {
    key: "advocate",
    label: "Customer Advocates",
    job: "Real customers and nano-creators who post authentically and drive word-of-mouth and repeat purchase.",
    nextAction: "Seed a sample with an affiliate code; invite the best into a retention loop.",
    audienceHint: "Under 10k followers / verified buyers",
  },
];

export const RING_KEYS: RingKey[] = RINGS.map((r) => r.key);

export function isRingKey(v: unknown): v is RingKey {
  return typeof v === "string" && (RING_KEYS as string[]).includes(v);
}

export function ringMeta(key: string | null | undefined): Ring | null {
  if (!key) return null;
  return RINGS.find((r) => r.key === key) ?? null;
}

/**
 * Suggest a ring from audience size (the primary, non-sensitive signal). This is
 * a recommendation only — the operator always confirms/edits. Verified buyers
 * (first-party source) bias toward advocate regardless of size.
 */
export function suggestRing(
  input: FitInput & { source?: string | null },
): RingKey {
  if (input.source === "first_party") return "advocate";
  const f = input.followerCount ?? 0;
  if (f >= 100_000) return "signal";
  if (f >= 10_000) return "editorial";
  return "advocate";
}
