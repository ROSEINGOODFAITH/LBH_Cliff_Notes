/**
 * Canonical creator lifecycle — the single source of truth for where a creator
 * is. `creators.stage` (creatorStageEnum) is the ONLY authoritative lifecycle
 * field. The legacy `creators.status` (creatorStatusEnum) is deprecated: it is
 * no longer read or written for lifecycle decisions. All readers/writers go
 * through the helpers here so the overview dashboard, the /pulse belt, the
 * creator list, and every background job agree.
 *
 * Legacy note: `status` is retained as a nullable, non-authoritative column for
 * one release (two-phase migration) so a rollback can still read old values.
 * Physical removal of the column + `creator_status` enum is a documented
 * follow-up (blocked only by `campaign_creators.stage`, which is mistyped with
 * the same enum — see the migration notes).
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

/** All stages in canonical (happy-path then terminal) order — for filters/pickers. */
export const CREATOR_STAGES = Object.keys(STAGE_META) as CreatorStage[];

/** Stages at which a creator is in a live collaboration (post-onboarding). */
export const ACTIVE_STAGES: CreatorStage[] = ["onboarded", "shipped", "posted", "paid"];

/**
 * Stages that mean "we're actively engaged with this creator" — replied through
 * paid. Used by content/mention tracking (which previously keyed off the legacy
 * status set `active|negotiating|replied`).
 */
export const ENGAGED_STAGES: CreatorStage[] = ["replied", ...ACTIVE_STAGES];

/** Terminal stages: no outward transitions. `paid` is a successful terminal. */
export const TERMINAL_STAGES: CreatorStage[] = ["paid", "rejected", "churned"];

export function isTerminalStage(stage: CreatorStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

/**
 * Allowed forward transitions of the canonical state machine. Any non-terminal
 * stage may also move to `churned` (opt-out / removal). This graph is what
 * prevents invalid regressions (e.g. a `paid` creator silently dropping back to
 * `contacted`).
 */
export const STAGE_TRANSITIONS: Record<CreatorStage, CreatorStage[]> = {
  sourced: ["review", "contacted", "rejected", "churned"],
  review: ["contacted", "onboarded", "rejected", "churned"],
  contacted: ["replied", "onboarded", "churned"],
  replied: ["onboarded", "churned"],
  onboarded: ["shipped", "churned"],
  shipped: ["posted", "churned"],
  posted: ["paid", "churned"],
  paid: [],
  rejected: [],
  churned: [],
};

/** A no-op (from === to) is always valid; otherwise the edge must be allowed. */
export function canTransition(from: CreatorStage, to: CreatorStage): boolean {
  if (from === to) return true;
  return STAGE_TRANSITIONS[from].includes(to);
}

export class InvalidStageTransition extends Error {
  constructor(
    public readonly from: CreatorStage,
    public readonly to: CreatorStage,
  ) {
    super(`Invalid creator stage transition: ${from} → ${to}`);
    this.name = "InvalidStageTransition";
  }
}

export function assertTransition(from: CreatorStage, to: CreatorStage): void {
  if (!canTransition(from, to)) throw new InvalidStageTransition(from, to);
}

/**
 * Monotonic forward progress along the happy path. Returns the stage to
 * persist: `target` when it is strictly further along than `current`, otherwise
 * `current` unchanged. Terminal stages are sticky (never revived), and this
 * never regresses a more-advanced creator — so a legacy code path that wants to
 * mark someone "onboarded" can't knock back a creator who is already `posted`.
 * For removals/rejections use an explicit guarded transition, not this.
 */
export function advanceStage(current: CreatorStage, target: CreatorStage): CreatorStage {
  if (isTerminalStage(current)) return current;
  if (TERMINAL_STAGES.includes(target)) return current;
  return STAGE_META[target].order > STAGE_META[current].order ? target : current;
}

/* ---------------------------------------------------------------------------
 * Legacy `status` → canonical `stage` translation (consolidation).
 * The legacy CRM status enum is being retired; this is the one place that maps
 * an old value onto the canonical lifecycle, used by the backfill migration and
 * by any remaining reader that must interpret a historical status.
 * ------------------------------------------------------------------------- */
export type LegacyCreatorStatus =
  | "prospect"
  | "contacted"
  | "replied"
  | "negotiating"
  | "active"
  | "declined"
  | "dormant";

export const STATUS_TO_STAGE: Record<LegacyCreatorStatus, CreatorStage> = {
  prospect: "sourced",
  contacted: "contacted",
  replied: "replied",
  negotiating: "replied",
  active: "onboarded",
  declined: "rejected",
  dormant: "churned",
};

export function statusToStage(status: string | null | undefined): CreatorStage {
  return (status && STATUS_TO_STAGE[status as LegacyCreatorStatus]) || "sourced";
}

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
 * Ordered, narrowing funnel steps — the canonical description of the overview
 * funnel. The shared <Funnel> component renders exclusively from this, so there
 * is one definition of the pipeline shape and labels.
 */
export const FUNNEL_STEPS: Array<{ key: keyof FunnelCounts; label: string }> = [
  { key: "discovered", label: "Discovered" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "active", label: "Active" },
  { key: "posted", label: "Posted" },
];

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
