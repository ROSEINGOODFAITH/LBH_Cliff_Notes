/**
 * Screenshot ingestion — pure helpers for turning an OCR/vision extraction of a
 * TikTok/Instagram profile into a REVIEWABLE draft. The cardinal rule: an
 * uploaded screenshot only ever SUGGESTS field values. It must never silently
 * create a creator, never infer that outreach or a reply happened, and never
 * default the canonical stage to `replied`. The operator confirms everything on
 * a review screen before anything is written.
 */
import type { CreatorStage } from "@/lib/lifecycle";
import type { RelationshipTier } from "@/lib/relationship";
import { DEFAULT_RELATIONSHIP_TIER } from "@/lib/relationship";
import { suggestNextAction, type ReviewNextAction } from "@/lib/pulse-flow";

export type ExtractPlatform = "tiktok" | "instagram";

/** A single extracted field carrying its own confidence, so the UI can flag it. */
export interface ExtractedField<T> {
  value: T | null;
  /** 0..1 model/heuristic confidence in this specific field. */
  confidence: number;
}

export interface ExtractedProfile {
  handle: ExtractedField<string>;
  platform: ExtractedField<ExtractPlatform>;
  displayName: ExtractedField<string>;
  email: ExtractedField<string>;
  followerCount: ExtractedField<number>;
  bio: ExtractedField<string>;
  profileUrl: ExtractedField<string>;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Handles: 2–30 chars, lowercase letters/digits/dot/underscore (matches intake). */
export const HANDLE_RE = /^[a-z0-9._]{2,30}$/;

/** Strip URLs / @ / query-fragments from a handle, lowercased. Mirrors source intake. */
export function normalizeHandle(h: string): string {
  return h
    .trim()
    .replace(/^https?:\/\/(www\.)?(tiktok\.com\/@?|instagram\.com\/)/i, "")
    .replace(/[?#/].*$/, "")
    .replace(/^@+/, "")
    .toLowerCase();
}

/**
 * The default canonical stage for a NEWLY uploaded screenshot. Always the
 * earliest prospect/discovered stage — NEVER `replied`, NEVER `contacted`.
 * Independent of relationship tier (tier only influences the suggested action).
 */
export function defaultStageForUpload(): CreatorStage {
  return "sourced";
}

/** A field is "low confidence" below this threshold — surfaced for the operator. */
export const LOW_CONFIDENCE = 0.6;

export interface ReviewField {
  key: keyof ExtractedProfile;
  label: string;
  value: string | number | null;
  confidence: number;
  /** Missing (no value extracted) — must be filled/confirmed by the operator. */
  missing: boolean;
  /** Present but low-confidence — worth a second look. */
  lowConfidence: boolean;
}

const FIELD_LABELS: Record<keyof ExtractedProfile, string> = {
  handle: "Handle",
  platform: "Platform",
  displayName: "Display name",
  email: "Email",
  followerCount: "Followers",
  bio: "Bio",
  profileUrl: "Profile URL",
};

export interface ReviewModel {
  fields: ReviewField[];
  /** Overall confidence = mean of present-field confidences (0 when nothing found). */
  confidence: number;
  /** Keys with no extracted value. */
  missing: (keyof ExtractedProfile)[];
  /** Keys present but below the low-confidence threshold. */
  lowConfidence: (keyof ExtractedProfile)[];
  /** The safe default stage (always earliest prospect stage). */
  defaultStage: CreatorStage;
  /** Default relationship tier for a brand-new record. */
  defaultTier: RelationshipTier;
  /** Suggested next action given the default tier (operator may override). */
  suggestedNextAction: ReviewNextAction;
}

/**
 * Build the review model the confirmation screen renders from. Pure: it computes
 * which fields are missing / low-confidence and the SAFE defaults, but decides
 * nothing on the operator's behalf.
 */
export function buildReviewModel(
  profile: ExtractedProfile,
  tier: RelationshipTier = DEFAULT_RELATIONSHIP_TIER,
): ReviewModel {
  const keys = Object.keys(FIELD_LABELS) as (keyof ExtractedProfile)[];
  const fields: ReviewField[] = keys.map((key) => {
    const f = profile[key];
    const missing = f.value == null || f.value === "";
    return {
      key,
      label: FIELD_LABELS[key],
      value: f.value as string | number | null,
      confidence: f.confidence,
      missing,
      lowConfidence: !missing && f.confidence < LOW_CONFIDENCE,
    };
  });

  const present = fields.filter((f) => !f.missing);
  const confidence = present.length ? present.reduce((s, f) => s + f.confidence, 0) / present.length : 0;

  return {
    fields,
    confidence: Math.round(confidence * 100) / 100,
    missing: fields.filter((f) => f.missing).map((f) => f.key),
    lowConfidence: fields.filter((f) => f.lowConfidence).map((f) => f.key),
    defaultStage: defaultStageForUpload(),
    defaultTier: tier,
    suggestedNextAction: suggestNextAction(tier),
  };
}

/** Coerce loose model/JSON output into a well-formed ExtractedField. */
export function field<T>(value: T | null | undefined, confidence: unknown): ExtractedField<T> {
  const c = typeof confidence === "number" && Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  return { value: value ?? null, confidence: value == null ? 0 : c };
}

export interface ConfirmInput {
  handle?: string | null;
  platform?: string | null;
  email?: string | null;
}

export interface ConfirmValidation {
  ok: boolean;
  errors: string[];
  handle: string | null;
  platform: ExtractPlatform | null;
  email: string | null;
}

/**
 * Validate the operator-confirmed identity before a save. Requires a valid
 * handle; email is optional but validated when present. Never inspects/mutates
 * stage — that is the operator's explicit choice elsewhere.
 */
export function validateConfirm(input: ConfirmInput): ConfirmValidation {
  const errors: string[] = [];
  const handle = input.handle ? normalizeHandle(input.handle) : "";
  if (!handle || !HANDLE_RE.test(handle)) errors.push("A valid handle is required.");

  const platform: ExtractPlatform | null = input.platform === "instagram" ? "instagram" : input.platform === "tiktok" ? "tiktok" : null;

  let email: string | null = null;
  if (input.email && input.email.trim()) {
    const e = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) errors.push("Email is not a valid address.");
    else email = e;
  }

  return { ok: errors.length === 0, errors, handle: handle || null, platform, email };
}
