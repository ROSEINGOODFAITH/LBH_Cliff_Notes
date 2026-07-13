/**
 * PULSE automation control center — a human-readable registry describing every
 * background automation as a rule: trigger, action, whether a human must approve,
 * delay, and whether it sends anything externally on its own.
 *
 * This registry is the SOURCE OF TRUTH FOR THE UI ONLY. It documents the
 * behavior implemented by the Inngest functions in src/inngest/functions/*; it
 * does not itself run anything. The safety invariant `assertAutoSendGuardrails`
 * encodes guardrail §9: money never moves automatically, and no external message
 * to a creator is auto-sent unless it rides a mechanism the repo already treats
 * as safe (Smartlead-owned pacing / the mandatory shipped-with-disclosure email).
 */

export type AutomationCategory = "enrich" | "draft" | "gift" | "notify" | "monitor" | "flag";

export type AutomationRule = {
  id: string;
  label: string;
  category: AutomationCategory;
  /** Human sentence: what starts this rule. */
  trigger: string;
  /** Human sentence: what the rule does. */
  action: string;
  /** Does a human have to approve before the effect is applied? */
  approvalRequired: boolean;
  /**
   * Does this rule cause an EXTERNAL message to a creator to be sent without a
   * per-message human tap? Only allowed for mechanisms the repo already governs
   * (Smartlead owns send pacing; the shipped email is mandatory disclosure).
   */
  autoSendsExternal: boolean;
  /** Human sentence describing any delay/schedule. */
  delay: string;
  /** Safe to enable by default? Risky rules default off and say why. */
  safeDefault: boolean;
  /** The Inngest function id that implements this (for traceability). */
  implementedBy: string | null;
  /** Whether the implementing capability is wired up in this codebase. */
  enabled: boolean;
  notes?: string;
};

/**
 * The suggested safe-default rule set, mapped 1:1 onto real Inngest functions
 * where they exist. `enabled` reflects whether the underlying capability ships
 * in this repo; the operator toggles the human-approved steps, never auto-send.
 */
export const AUTOMATION_RULES: AutomationRule[] = [
  {
    id: "enrich-on-add",
    label: "Enrich on creator add",
    category: "enrich",
    trigger: "A creator is sourced or imported",
    action: "Compute fit score from imported data, move to Your call",
    approvalRequired: false,
    autoSendsExternal: false,
    delay: "Immediately",
    safeDefault: true,
    implementedBy: "pulse-enrich-on-sourced",
    enabled: true,
  },
  {
    id: "draft-invite-on-qualify",
    label: "Draft invite after approval",
    category: "draft",
    trigger: "You approve a creator (tier A/B)",
    action: "Queue a PULSE invitation draft for your review — not sent",
    approvalRequired: true,
    autoSendsExternal: false,
    delay: "Immediately after your decision",
    safeDefault: true,
    implementedBy: "pulse-outreach-on-tiered",
    enabled: true,
    notes: "Sending pacing is owned by Smartlead; the app never blasts.",
  },
  {
    id: "gift-after-consent",
    label: "Create gift after consent",
    category: "gift",
    trigger: "Address form submitted by an invited/replied creator",
    action: "Create the Shopify gift draft order to their address",
    approvalRequired: false,
    autoSendsExternal: false,
    delay: "On form submission, once per creator (idempotent claim)",
    safeDefault: true,
    implementedBy: "pulse-onboard-tally",
    enabled: true,
    notes: "Guarded by provisioning claims — never double-gifts.",
  },
  {
    id: "shipped-email",
    label: "Shipment + disclosure email",
    category: "notify",
    trigger: "Tracking number appears on a gift order",
    action: "Email tracking, brief, code, and the #ad disclosure line",
    approvalRequired: false,
    autoSendsExternal: true,
    delay: "Hourly fulfillment poll",
    safeDefault: true,
    implementedBy: "pulse-fulfill-poll",
    enabled: true,
    notes: "Mandatory: a shipped package must carry disclosure guidance.",
  },
  {
    id: "delivery-check-in",
    label: "Draft delivery check-in",
    category: "draft",
    trigger: "A gift is delivered",
    action: "Queue a friendly check-in draft for your review",
    approvalRequired: true,
    autoSendsExternal: false,
    delay: "A few days after delivery",
    safeDefault: true,
    implementedBy: null,
    enabled: false,
    notes: "Template ready; wire to a delivery signal to enable.",
  },
  {
    id: "review-request",
    label: "Draft review request",
    category: "draft",
    trigger: "A delivered creator has had product for N days",
    action: "Queue a review-request draft for your review",
    approvalRequired: true,
    autoSendsExternal: false,
    delay: "Configurable delay after delivery",
    safeDefault: true,
    implementedBy: null,
    enabled: false,
  },
  {
    id: "overdue-followup",
    label: "Flag overdue follow-ups",
    category: "flag",
    trigger: "A contacted creator goes quiet past the threshold",
    action: "Surface them in the attention queue (max 2 nudges, then churn)",
    approvalRequired: false,
    autoSendsExternal: false,
    delay: "Daily, after 10 quiet days",
    safeDefault: true,
    implementedBy: "pulse-activation-check",
    enabled: true,
  },
  {
    id: "monitor-content",
    label: "Monitor handles for posts",
    category: "monitor",
    trigger: "A tracked creator posts about the brand",
    action: "Detect the post and record a content mention",
    approvalRequired: false,
    autoSendsExternal: false,
    delay: "Every 6 hours",
    safeDefault: true,
    implementedBy: "sync-content-mentions",
    enabled: true,
  },
  {
    id: "content-review-task",
    label: "Create content-review task",
    category: "flag",
    trigger: "A new post is detected",
    action: "Add it to the content review queue for a decision",
    approvalRequired: true,
    autoSendsExternal: false,
    delay: "On detection",
    safeDefault: true,
    implementedBy: "pulse-compliance-on-posted",
    enabled: true,
  },
  {
    id: "surface-amplify",
    label: "Surface high performers",
    category: "flag",
    trigger: "A post drives strong performance / attributed sales",
    action: "Surface the creator for paid amplification or retention",
    approvalRequired: true,
    autoSendsExternal: false,
    delay: "Continuously as orders attribute",
    safeDefault: true,
    implementedBy: "sync-shopify-orders",
    enabled: true,
  },
];

/**
 * Guardrail invariant. Any rule that sends an external message on its own MUST
 * be on the small allow-list of repo-governed mechanisms; everything else must
 * keep auto-send OFF. Throws if a rule violates this so a bad edit can't silently
 * enable mass auto-sending. Pure — safe to call in tests.
 */
const AUTO_SEND_ALLOWLIST = new Set(["shipped-email"]);

export function assertAutoSendGuardrails(rules: AutomationRule[] = AUTOMATION_RULES): void {
  for (const r of rules) {
    if (r.autoSendsExternal && !AUTO_SEND_ALLOWLIST.has(r.id)) {
      throw new Error(
        `Automation "${r.id}" auto-sends external messages but is not on the governed allow-list. ` +
          `Auto-send must stay off unless it rides a repo-approved mechanism.`,
      );
    }
    // A rule that moves money must require approval (money never moves automatically).
    if (r.category === "gift" && r.autoSendsExternal) {
      throw new Error(`Gift automation "${r.id}" must not auto-send/charge externally.`);
    }
  }
}

/** Convenience for the UI: only rules whose capability actually ships here. */
export function enabledRules(rules: AutomationRule[] = AUTOMATION_RULES): AutomationRule[] {
  return rules.filter((r) => r.enabled);
}
