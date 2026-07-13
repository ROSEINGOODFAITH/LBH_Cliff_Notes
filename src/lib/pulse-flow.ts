/**
 * PULSE action flow — the editable, ordered set of actions the operator runs
 * AROUND the canonical creator lifecycle. This is NOT a competing lifecycle:
 * `creators.stage` (lib/lifecycle.ts) stays the single source of truth for where
 * a creator is. A flow step declares "when a creator is at stage X, the action
 * we take is Y" — it orchestrates drafting/approval/sending/waiting, never
 * silently advancing the stage and never auto-sending external email unless it
 * rides a repo-governed exception (see AUTO_SEND_ALLOWLIST / pulse-automations).
 *
 * Everything here is pure and deterministic so the whole engine is unit-testable
 * without a database or network.
 */
import type { CreatorStage } from "@/lib/lifecycle";
import type { TemplateKey } from "@/lib/pulse-templates";
import type { RelationshipTier } from "@/lib/relationship";
import { RELATIONSHIP_TIERS } from "@/lib/relationship";

/* ----------------------------- action types ------------------------------- */

export type FlowActionType =
  | "qualify" // internal: surface for human fit review
  | "draft" // draft an email from a template for human review — never sends
  | "approval" // explicit human approval gate before an external send
  | "send_email" // external send (must be gated by approval)
  | "wait" // delay before the next step
  | "collect_form" // send/collect the address form
  | "gift" // create the gift order (goods/money) after address consent
  | "wait_delivery" // wait for fulfillment/delivery signal
  | "request_content" // ask for a post / review after a delay
  | "request_usage_rights" // license strong content
  | "surface" // internal: surface for paid amplification
  | "retain"; // internal: retention / FAM review

export interface ActionTypeMeta {
  label: string;
  /** Does this action need a message template configured? */
  needsTemplate: boolean;
  /** Does this action require a wait/delay to be meaningful? */
  needsDelay: boolean;
  /** Does executing this action send an EXTERNAL message to the creator? */
  sendsExternal: boolean;
  /** Does this action move goods/money (requires consent + guardrails)? */
  movesValue: boolean;
}

export const ACTION_TYPES: Record<FlowActionType, ActionTypeMeta> = {
  qualify: { label: "Qualify creator", needsTemplate: false, needsDelay: false, sendsExternal: false, movesValue: false },
  draft: { label: "Draft email", needsTemplate: true, needsDelay: false, sendsExternal: false, movesValue: false },
  approval: { label: "Human approval", needsTemplate: false, needsDelay: false, sendsExternal: false, movesValue: false },
  send_email: { label: "Send email", needsTemplate: true, needsDelay: false, sendsExternal: true, movesValue: false },
  wait: { label: "Wait", needsTemplate: false, needsDelay: true, sendsExternal: false, movesValue: false },
  collect_form: { label: "Collect address form", needsTemplate: true, needsDelay: false, sendsExternal: true, movesValue: false },
  gift: { label: "Gift after consent", needsTemplate: false, needsDelay: false, sendsExternal: false, movesValue: true },
  wait_delivery: { label: "Wait for delivery", needsTemplate: false, needsDelay: false, sendsExternal: false, movesValue: false },
  request_content: { label: "Request content / review", needsTemplate: true, needsDelay: true, sendsExternal: true, movesValue: false },
  request_usage_rights: { label: "Request usage rights", needsTemplate: true, needsDelay: false, sendsExternal: true, movesValue: false },
  surface: { label: "Surface for amplification", needsTemplate: false, needsDelay: false, sendsExternal: false, movesValue: false },
  retain: { label: "Retain / FAM review", needsTemplate: false, needsDelay: false, sendsExternal: false, movesValue: false },
};

export const FLOW_ACTION_TYPES = Object.keys(ACTION_TYPES) as FlowActionType[];

/**
 * The only mechanism allowed to send external email WITHOUT a per-message human
 * approval, mirroring the guardrail in lib/pulse-automations.ts: the mandatory
 * shipment + #ad disclosure email that must ride along with a shipped gift.
 */
export const AUTO_SEND_ALLOWLIST = new Set<string>(["shipped-disclosure"]);

/* ------------------------------- flow step -------------------------------- */

export interface FlowStep {
  /** Stable, unique identifier (kebab-case). */
  key: string;
  name: string;
  actionType: FlowActionType;
  /** Canonical stage this action orbits (its trigger/at). Never mutated by the flow. */
  stage: CreatorStage | null;
  /** Which relationship tiers this step applies to. */
  tiers: RelationshipTier[];
  templateKey: TemplateKey | null;
  /** Delay before this step runs, in minutes. */
  delayMinutes: number | null;
  approvalRequired: boolean;
  /** Sends external email automatically — must stay false unless allow-listed. */
  autoSendsExternal: boolean;
  enabled: boolean;
  /** The next step in the sequence, by key. null = end of flow. */
  nextStepKey: string | null;
}

/* --------------------------- per-creator run ------------------------------ */

export type FlowRunStatus =
  | "pending"
  | "waiting"
  | "approval_needed"
  | "scheduled"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export const FLOW_RUN_STATUSES: FlowRunStatus[] = [
  "pending",
  "waiting",
  "approval_needed",
  "scheduled",
  "completed",
  "failed",
  "skipped",
  "cancelled",
];

/** Operator actions permitted on a per-creator run, by its current status. */
export const RUN_TRANSITIONS: Record<FlowRunStatus, FlowRunStatus[]> = {
  pending: ["scheduled", "approval_needed", "skipped", "cancelled"],
  waiting: ["scheduled", "skipped", "cancelled"],
  approval_needed: ["scheduled", "skipped", "cancelled"], // approve → scheduled
  scheduled: ["completed", "failed", "cancelled"], // reschedule stays scheduled (no-op edge)
  failed: ["scheduled", "skipped", "cancelled"], // retry → scheduled
  completed: [],
  skipped: ["scheduled"], // un-skip → re-schedule
  cancelled: ["scheduled"], // re-open
};

export function canRunTransition(from: FlowRunStatus, to: FlowRunStatus): boolean {
  if (from === to) return true;
  return RUN_TRANSITIONS[from].includes(to);
}

/** Operator-initiated actions on a per-creator run (spec A6 / D). */
export type RunOperatorAction = "approve" | "skip" | "retry" | "reschedule" | "cancel";

/**
 * Target status for an operator action given the run's current status, or null
 * if the action isn't permitted from `from`. Encodes the guardrail that only an
 * `approval_needed` run can be `approve`d into a schedulable state.
 */
export function runActionTarget(action: RunOperatorAction, from: FlowRunStatus): FlowRunStatus | null {
  const target: FlowRunStatus | null = (() => {
    switch (action) {
      case "approve":
        return from === "approval_needed" ? "scheduled" : null;
      case "retry":
        return from === "failed" ? "scheduled" : null;
      case "reschedule":
        return from === "scheduled" || from === "waiting" ? "scheduled" : null;
      case "skip":
        return "skipped";
      case "cancel":
        return "cancelled";
      default:
        return null;
    }
  })();
  if (target == null) return null;
  return canRunTransition(from, target) ? target : null;
}

/* ---------------------------- default flow -------------------------------- */

/**
 * The editable PULSE starter flow (spec part C), mapped onto real canonical
 * stages/events. Steps are linked sequentially by `nextStepKey`. Every external
 * send is gated by an explicit `approval` step first; nothing auto-sends.
 * `autoSendsExternal` is false on every step here — the shipment/disclosure
 * exception is owned by the fulfillment poller, not this editable flow.
 */
export const DEFAULT_FLOW_STEPS: FlowStep[] = [
  { key: "qualify", name: "Qualify creator", actionType: "qualify", stage: "review", tiers: ["COLD", "WARM", "FAM"], templateKey: null, delayMinutes: null, approvalRequired: true, autoSendsExternal: false, enabled: true, nextStepKey: "draft-invite" },
  { key: "draft-invite", name: "Draft curated invite", actionType: "draft", stage: "review", tiers: ["COLD", "WARM", "FAM"], templateKey: "invite", delayMinutes: null, approvalRequired: false, autoSendsExternal: false, enabled: true, nextStepKey: "approve-invite" },
  { key: "approve-invite", name: "Human approval", actionType: "approval", stage: "review", tiers: ["COLD", "WARM", "FAM"], templateKey: null, delayMinutes: null, approvalRequired: true, autoSendsExternal: false, enabled: true, nextStepKey: "send-invite" },
  { key: "send-invite", name: "Send invite via Gmail", actionType: "send_email", stage: "contacted", tiers: ["COLD", "WARM", "FAM"], templateKey: "invite", delayMinutes: null, approvalRequired: true, autoSendsExternal: false, enabled: true, nextStepKey: "wait-reply" },
  { key: "wait-reply", name: "Wait for a reply", actionType: "wait", stage: "contacted", tiers: ["COLD", "WARM", "FAM"], templateKey: null, delayMinutes: 4320, approvalRequired: false, autoSendsExternal: false, enabled: true, nextStepKey: "follow-up" },
  { key: "follow-up", name: "Follow up if no reply", actionType: "draft", stage: "contacted", tiers: ["COLD", "WARM"], templateKey: "follow_up", delayMinutes: null, approvalRequired: true, autoSendsExternal: false, enabled: true, nextStepKey: "collect-form" },
  { key: "collect-form", name: "Collect address on acceptance", actionType: "collect_form", stage: "replied", tiers: ["COLD", "WARM", "FAM"], templateKey: "form_reminder", delayMinutes: null, approvalRequired: true, autoSendsExternal: false, enabled: true, nextStepKey: "gift" },
  { key: "gift", name: "Gift after address consent", actionType: "gift", stage: "onboarded", tiers: ["COLD", "WARM", "FAM"], templateKey: null, delayMinutes: null, approvalRequired: true, autoSendsExternal: false, enabled: true, nextStepKey: "wait-delivery" },
  { key: "wait-delivery", name: "Wait for delivery", actionType: "wait_delivery", stage: "shipped", tiers: ["COLD", "WARM", "FAM"], templateKey: null, delayMinutes: null, approvalRequired: false, autoSendsExternal: false, enabled: true, nextStepKey: "check-in" },
  { key: "check-in", name: "Draft delivery check-in", actionType: "draft", stage: "shipped", tiers: ["COLD", "WARM", "FAM"], templateKey: "delivery_check_in", delayMinutes: 4320, approvalRequired: true, autoSendsExternal: false, enabled: true, nextStepKey: "request-review" },
  { key: "request-review", name: "Request content / review", actionType: "request_content", stage: "shipped", tiers: ["COLD", "WARM", "FAM"], templateKey: "review_request", delayMinutes: 10080, approvalRequired: true, autoSendsExternal: false, enabled: true, nextStepKey: "usage-rights" },
  { key: "usage-rights", name: "Request usage rights", actionType: "request_usage_rights", stage: "posted", tiers: ["COLD", "WARM", "FAM"], templateKey: "content_permission", delayMinutes: null, approvalRequired: true, autoSendsExternal: false, enabled: true, nextStepKey: "amplify" },
  { key: "amplify", name: "Surface for paid amplification", actionType: "surface", stage: "posted", tiers: ["WARM", "FAM"], templateKey: null, delayMinutes: null, approvalRequired: true, autoSendsExternal: false, enabled: true, nextStepKey: "retain" },
  { key: "retain", name: "Retain / FAM review", actionType: "retain", stage: "paid", tiers: ["FAM"], templateKey: "retention", delayMinutes: null, approvalRequired: true, autoSendsExternal: false, enabled: true, nextStepKey: null },
];

export function cloneDefaultFlow(): FlowStep[] {
  return DEFAULT_FLOW_STEPS.map((s) => ({ ...s, tiers: [...s.tiers] }));
}

/* ------------------------------ reordering -------------------------------- */

/** Move a step up (-1) or down (+1); returns a new array, out-of-range is a no-op. */
export function moveStep(steps: FlowStep[], index: number, dir: -1 | 1): FlowStep[] {
  const target = index + dir;
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) return steps.slice();
  const next = steps.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return relink(next);
}

/**
 * Re-thread `nextStepKey` to follow array order (each step points to the next by
 * position; the last points to null). Keeps the sequence coherent after any
 * add/remove/reorder so a positional edit can't create dangling references.
 */
export function relink(steps: FlowStep[]): FlowStep[] {
  return steps.map((s, i) => ({ ...s, nextStepKey: i < steps.length - 1 ? steps[i + 1].key : null }));
}

export function removeStep(steps: FlowStep[], key: string): FlowStep[] {
  return relink(steps.filter((s) => s.key !== key));
}

/* ------------------------------ validation -------------------------------- */

export type FlowIssueCode =
  | "missing_template"
  | "missing_delay"
  | "invalid_next_ref"
  | "cycle"
  | "external_send_without_approval"
  | "duplicate_id"
  | "unreachable";

export interface FlowIssue {
  code: FlowIssueCode;
  severity: "error" | "warning";
  stepKey: string | null;
  message: string;
}

/**
 * Validate a flow (spec part A5). Returns every problem found; an empty array
 * means the flow is safe to save. Only `enabled` steps are checked for the
 * runtime-safety rules (template/delay/approval) — a disabled step is inert.
 */
export function validateFlow(steps: FlowStep[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const keys = steps.map((s) => s.key);
  const keySet = new Set(keys);

  // duplicate identifiers
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) issues.push({ code: "duplicate_id", severity: "error", stepKey: k, message: `Duplicate step id "${k}".` });
    seen.add(k);
  }

  for (const s of steps) {
    const meta = ACTION_TYPES[s.actionType];
    if (!s.enabled) continue;

    if (meta.needsTemplate && !s.templateKey)
      issues.push({ code: "missing_template", severity: "error", stepKey: s.key, message: `"${s.name}" needs a message template.` });

    if (meta.needsDelay && (s.delayMinutes == null || s.delayMinutes <= 0))
      issues.push({ code: "missing_delay", severity: "error", stepKey: s.key, message: `"${s.name}" needs a positive delay.` });

    if (s.autoSendsExternal && !s.approvalRequired && !AUTO_SEND_ALLOWLIST.has(s.key))
      issues.push({
        code: "external_send_without_approval",
        severity: "error",
        stepKey: s.key,
        message: `"${s.name}" auto-sends external email without approval and is not on the governed allow-list.`,
      });

    if (s.nextStepKey != null && !keySet.has(s.nextStepKey))
      issues.push({ code: "invalid_next_ref", severity: "error", stepKey: s.key, message: `"${s.name}" points to a missing step "${s.nextStepKey}".` });
  }

  // cycle detection over nextStepKey edges (only valid refs)
  if (!issues.some((i) => i.code === "invalid_next_ref")) {
    const byKey = new Map(steps.map((s) => [s.key, s]));
    for (const start of steps) {
      const slow = start.key;
      let a: string | null = slow;
      let b: string | null = byKey.get(slow)?.nextStepKey ?? null;
      // Floyd cycle detection
      while (a && b) {
        if (a === b) {
          issues.push({ code: "cycle", severity: "error", stepKey: a, message: `Flow contains a cycle reachable from "${start.key}".` });
          break;
        }
        a = byKey.get(a)?.nextStepKey ?? null;
        b = byKey.get(b)?.nextStepKey ?? null;
        b = b ? byKey.get(b)?.nextStepKey ?? null : null;
      }
    }
  }

  // unreachable steps: reachable from the first step via nextStepKey.
  if (steps.length > 1 && !issues.some((i) => i.code === "cycle" || i.code === "invalid_next_ref")) {
    const byKey = new Map(steps.map((s) => [s.key, s]));
    const reachable = new Set<string>();
    let cur: string | null = steps[0].key;
    while (cur && !reachable.has(cur)) {
      reachable.add(cur);
      cur = byKey.get(cur)?.nextStepKey ?? null;
    }
    for (const s of steps) {
      if (!reachable.has(s.key))
        issues.push({ code: "unreachable", severity: "warning", stepKey: s.key, message: `"${s.name}" is not reachable from the start of the flow.` });
    }
  }

  return issues;
}

export function flowHasErrors(steps: FlowStep[]): boolean {
  return validateFlow(steps).some((i) => i.severity === "error");
}

/** Dedupe filter used by the UI/API: only issues, unique by code+step. */
export function isFlowValid(steps: FlowStep[]): boolean {
  return !flowHasErrors(steps);
}

/* ------------------------- review "next action" --------------------------- */

/**
 * The operator's explicit choice of what happens next after confirming a
 * screenshot (spec part 5). Recording one writes an `events` row only — it never
 * sends email or advances the stage on its own.
 */
export type ReviewNextAction =
  | "none"
  | "qualify"
  | "draft_invite"
  | "send_invite"
  | "gift"
  | "follow_up"
  | "add_to_campaign"
  | "retain";

export interface ReviewNextActionMeta {
  key: ReviewNextAction;
  label: string;
  /** Does choosing this queue a draft/schedule (still approval-gated)? */
  queues: boolean;
}

export const REVIEW_NEXT_ACTIONS: ReviewNextActionMeta[] = [
  { key: "none", label: "Nothing yet — just save", queues: false },
  { key: "qualify", label: "Qualify", queues: false },
  { key: "draft_invite", label: "Draft invite", queues: true },
  { key: "send_invite", label: "Send invite (after approval)", queues: true },
  { key: "gift", label: "Gift", queues: false },
  { key: "follow_up", label: "Follow up", queues: true },
  { key: "add_to_campaign", label: "Add to campaign", queues: false },
  { key: "retain", label: "Retain", queues: false },
];

const REVIEW_ACTION_KEYS = new Set(REVIEW_NEXT_ACTIONS.map((a) => a.key));

export function isReviewNextAction(v: unknown): v is ReviewNextAction {
  return typeof v === "string" && REVIEW_ACTION_KEYS.has(v as ReviewNextAction);
}

/**
 * Tier-driven SUGGESTION for the next action (spec part 6). This is only a
 * default the operator can override; it never changes the stage or sends. The
 * default stage for a newly uploaded screenshot is always the earliest prospect
 * stage regardless of tier (see `defaultStageForUpload`).
 */
export function suggestNextAction(tier: RelationshipTier | null | undefined): ReviewNextAction {
  switch (tier) {
    case "WARM":
      return "draft_invite";
    case "FAM":
      return "add_to_campaign";
    case "COLD":
    default:
      return "qualify";
  }
}

export { RELATIONSHIP_TIERS };
