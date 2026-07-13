/**
 * PULSE outreach templates + campaign brief.
 *
 * These are the editable, human-approved starting points for every message in
 * the seeding journey. They are also the context injected into AI draft
 * generation (see lib/anthropic.ts `generateOutreach`), so the AI stays on-brief
 * and on-voice. Nothing here sends anything — drafting/queuing only. External
 * sends always require explicit human approval (guardrail §9.1/§9.4).
 *
 * The default first-touch is a CURATED INVITATION to a small product-testing
 * group with NO posting obligation. Fees/commission/amplification are considered
 * only after genuine fit and interest — never bundled into the cold invite.
 */
import type { PulseAngle } from "@/lib/pulse-fit";
import type { RingKey } from "@/lib/pulse-rings";

/** The campaign brief, in one place, reused by templates and AI drafting. */
export const PULSE_BRIEF = {
  product: "PULSE",
  brand: "Laurel Bath House",
  oneLiner: "a floral-and-grape eau de parfum",
  artDirection:
    "Inspired by Lycra, 1980s jazzercise, and Jane Fonda-era workout energy, with leopard print as a symbol of power. High-shine, maximalist, joyful.",
  scent: "bright grape and lush florals",
  /** The offer we actually lead with — a no-strings testing group. */
  invitationOffer:
    "an early sample as part of a small product-testing group — no posting required, we just want honest reactions from people with genuine taste",
  /** What we do NOT say in the cold invite. */
  doNotPromise: ["guaranteed payment", "a required post", "an affiliate quota"],
} as const;

export type TemplateKey =
  | "invite"
  | "form_reminder"
  | "shipment_notice"
  | "delivery_check_in"
  | "review_request"
  | "follow_up"
  | "content_permission"
  | "paid_upgrade"
  | "retention";

export type MessageTemplate = {
  key: TemplateKey;
  label: string;
  /** When in the journey this template is used. */
  when: string;
  /** Does sending this require explicit human approval? (Always true here.) */
  approvalRequired: boolean;
  subject: string;
  body: string;
};

export type TemplateVars = {
  handle: string;
  firstName?: string | null;
  angle?: PulseAngle | null;
  ring?: RingKey | null;
  trackingNumber?: string | null;
  briefUrl?: string | null;
  formUrl?: string | null;
  discountCode?: string | null;
  rateUsd?: number | null;
  senderName?: string;
};

/**
 * Editable default templates. `{{token}}` placeholders are filled by
 * `renderTemplate`. Bodies are plain text with real line breaks (no markdown),
 * matching the email pipeline's expectations.
 */
export const TEMPLATES: Record<TemplateKey, MessageTemplate> = {
  invite: {
    key: "invite",
    label: "Initial invitation",
    when: "First touch, after qualification is approved.",
    approvalRequired: true,
    subject: "A small PULSE testing group — no strings",
    body: `Hi {{firstName}},

I run creator partnerships at Laurel Bath House. We're about to launch PULSE, {{oneLiner}} — {{angleHook}}.

We're putting together {{invitationOffer}}. I'd love to send you one. There's genuinely no posting obligation — I just think your taste fits what we're building.

If you're curious, reply and I'll share a quick form for your address.

— {{senderName}}`,
  },
  form_reminder: {
    key: "form_reminder",
    label: "Acceptance / form reminder",
    when: "They said yes but haven't completed the address form.",
    approvalRequired: true,
    subject: "Your PULSE sample — one quick step",
    body: `Hi {{firstName}},

So glad you're in! To get PULSE out to you, I just need a shipping address here:

{{formUrl}}

Takes about a minute. Anything you'd rather I know first, just reply.

— {{senderName}}`,
  },
  shipment_notice: {
    key: "shipment_notice",
    label: "Shipment notice",
    when: "The gift order ships.",
    approvalRequired: true,
    subject: "PULSE is on the way",
    body: `Hi {{firstName}},

Your PULSE sample just shipped — tracking: {{trackingNumber}}.

If you do decide to share, one tiny thing: please tag it #ad or flip on the paid-partnership label. The creative brief (totally optional to follow) is here: {{briefUrl}}.

Can't wait to hear what you think of {{scent}}.

— {{senderName}}`,
  },
  delivery_check_in: {
    key: "delivery_check_in",
    label: "Delivery check-in",
    when: "A few days after delivery is confirmed.",
    approvalRequired: true,
    subject: "Did PULSE land?",
    body: `Hi {{firstName}},

Just checking PULSE arrived safely. No pressure at all — but if you have a first impression of {{scent}}, I'd genuinely love to hear it.

— {{senderName}}`,
  },
  review_request: {
    key: "review_request",
    label: "Review request",
    when: "After a delivered creator has had the product a while.",
    approvalRequired: true,
    subject: "Would you share your honest take on PULSE?",
    body: `Hi {{firstName}},

Hope you've been enjoying PULSE. If it's earned a spot in your rotation, would you consider sharing your honest take with your audience?

Only if it feels right — and if you do, please tag it #ad. Happy to send the brief or answer anything.

— {{senderName}}`,
  },
  follow_up: {
    key: "follow_up",
    label: "Gentle follow-up",
    when: "No reply to a previous message.",
    approvalRequired: true,
    subject: "Re: PULSE",
    body: `Hi {{firstName}},

Just floating this back up in case it slipped by. Totally fine if now's not the time — I only reach out to people whose work I actually admire, and yours is one.

— {{senderName}}`,
  },
  content_permission: {
    key: "content_permission",
    label: "Content permission / usage rights",
    when: "A post we'd like to license as brand creative exists.",
    approvalRequired: true,
    subject: "Loved your PULSE post — may we share it?",
    body: `Hi {{firstName}},

Your PULSE post is exactly the energy we hoped for. Would you be open to us featuring it on our channels and in some ads? We'd credit you and can agree simple terms — happy to compensate for usage.

If yes, I'll send a short usage-rights note to confirm.

— {{senderName}}`,
  },
  paid_upgrade: {
    key: "paid_upgrade",
    label: "Paid upgrade",
    when: "A great-fit creator we want to move to a paid, disclosed review.",
    approvalRequired: true,
    subject: "Let's make PULSE official",
    body: `Hi {{firstName}},

I've loved how naturally PULSE fits your world. We'd like to partner properly on a disclosed review — we're thinking around \${{rateUsd}} for one piece, and we can talk through what feels fair.

No rush; if it's interesting, reply and we'll sort the details (and yes, it'd be #ad).

— {{senderName}}`,
  },
  retention: {
    key: "retention",
    label: "Retention invitation",
    when: "Turning a one-off poster into an ongoing advocate.",
    approvalRequired: true,
    subject: "Stay in the PULSE inner circle?",
    body: `Hi {{firstName}},

You've been one of our favorite voices for PULSE. We're building a small standing group who get first access to what's next — early samples, your own code to share, and a real say in what we make.

Want in?

— {{senderName}}`,
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];

function fill(text: string, map: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => map[k] ?? "");
}

/** Render a template with campaign brief + creator vars. Missing vars → sensible fallbacks. */
export function renderTemplate(key: TemplateKey, vars: TemplateVars): { subject: string; body: string } {
  const t = TEMPLATES[key];
  const map: Record<string, string> = {
    firstName: vars.firstName?.trim() || `@${vars.handle.replace(/^@+/, "")}`,
    handle: vars.handle.replace(/^@+/, ""),
    senderName: vars.senderName || `the ${PULSE_BRIEF.brand} team`,
    oneLiner: PULSE_BRIEF.oneLiner,
    scent: PULSE_BRIEF.scent,
    invitationOffer: PULSE_BRIEF.invitationOffer,
    angleHook: vars.angle?.hook ?? "a scent with genuine point of view",
    trackingNumber: vars.trackingNumber ?? "(tracking to follow)",
    briefUrl: vars.briefUrl ?? "(brief link to follow)",
    formUrl: vars.formUrl ?? "(form link to follow)",
    discountCode: vars.discountCode ?? "",
    rateUsd: vars.rateUsd != null ? String(vars.rateUsd) : "a fair rate",
  };
  return { subject: fill(t.subject, map), body: fill(t.body, map) };
}
