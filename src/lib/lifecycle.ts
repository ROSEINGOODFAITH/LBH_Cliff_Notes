/**
 * Canonical creator lifecycle — single source of truth for the PULSE funnel.
 *
 * The `creators` table carries two lifecycle fields for historical reasons:
 *   - `stage` (creatorStageEnum) — the live PULSE campaign pipeline, driven by
 *     the sourcing → review → outreach → fulfillment automation. This is the
 *     real workflow.
 *   - `status` (creatorStatusEnum) — the legacy CRM status. Nothing in the
 *     PULSE flow updates it, so it is NOT authoritative for the funnel.
 *
 * Everything that renders "where is this creator" or counts the funnel should
 * derive from `stage` via the helpers here, so the overview dashboard, the
 * /pulse belt, and per-creator views all agree.
 */

export type CreatorStage =
  | "sourced"
  | "review"
  | "contacted"
  | "replied"
  | "onboarded"
  | "shipped"
  | "posted"
  | "paid"
  | "rejected"
  | "churned";

export type StageTone = "neutral" | "attention" | "active" | "done" | "dead";

export interface StageMeta {
  /** Operator-facing label — matches the /pulse "belt" vocabulary. */
  label: string;
  tone: StageTone;
  /** Order along the happy path; terminal/negative stages sort last. */
  order: number;
}

/**
 * Ordered, plain-word stations over the internal stages. `onboarded` and
 * `shipped` are both "Shipping" to the operator (order placed → in transit);
 * the distinction is internal to fulfillment polling.
 */
export const STAGE_META: Record<CreatorStage, StageMeta> = {
  sourced: { label: "Found", tone: "neutral", order: 0 },
  review: { label: "Your call", tone: "attention", order: 1 },
  contacted: { label: "Invited", tone: "active", order: 2 },
  replied: { label: "Replied", tone: "active", order: 3 },
  onboarded: { label: "Shipping", tone: "active", order: 4 },
  shipped: { label: "Shipping", tone: "active", order: 4 },
  posted: { label: "Posted", tone: "done", order: 5 },
  paid: { label: "Done", tone: "done", order: 6 },
  rejected: { label: "Passed", tone: "dead", order: 7 },
  churned: { label: "Removed", tone: "dead", order: 8 },
};

export function stageMeta(stage: string | null | undefined): StageMeta {
  return (stage && STAGE_META[stage as CreatorStage]) || STAGE_META.sourced;
}

/** Stages at which a creator is in a live collaboration (post-onboarding). */
export const ACTIVE_STAGES: CreatorStage[] = ["onboarded", "shipped", "posted", "paid"];

/**
 * Idempotency predicate for the gift-seeding flow. A creator is already
 * provisioned once a discount code has been minted or a Shopify draft order
 * created — either means outreach-on-tiered / onboard-tally already ran, so
 * re-processing a repeated `creator.tiered` event must NOT create a second
 * (free) order. Both fields are written only by those two PULSE functions.
 */
export function isProvisioned(c: {
  discountCode?: string | null;
  shopifyDraftOrderId?: string | null;
}): boolean {
  return Boolean(c.discountCode || c.shopifyDraftOrderId);
}

export interface FunnelCounts {
  discovered: number;
  contacted: number;
  replied: number;
  active: number;
  posted: number;
}

/**
 * Cumulative funnel buckets from raw per-stage counts. Buckets are cumulative
 * down the happy path: a "posted" creator also counts as contacted/replied/
 * active, so the funnel reads as a monotonically narrowing sequence. Negative
 * terminal stages (rejected/churned) count only toward `discovered`.
 */
export function funnelFromStages(
  rows: Array<{ stage: string | null; n: number | string }>,
): FunnelCounts {
  const count = (s: CreatorStage): number => {
    const row = rows.find((r) => r.stage === s);
    return row ? Number(row.n) : 0;
  };
  const discovered = rows.reduce((sum, r) => sum + Number(r.n), 0);
  const contactedPlus =
    count("contacted") +
    count("replied") +
    count("onboarded") +
    count("shipped") +
    count("posted") +
    count("paid");
  const repliedPlus =
    count("replied") +
    count("onboarded") +
    count("shipped") +
    count("posted") +
    count("paid");
  const active =
    count("onboarded") + count("shipped") + count("posted") + count("paid");
  const posted = count("posted") + count("paid");
  return { discovered, contacted: contactedPlus, replied: repliedPlus, active, posted };
}
