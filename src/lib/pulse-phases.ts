/**
 * PULSE guided launch phases.
 *
 * The operator thinks in launch phases (Define → Retain); the database thinks in
 * canonical creator stages (see lib/lifecycle.ts). This module is the ONE mapping
 * between the two — it never invents a competing lifecycle, it groups the
 * existing `creators.stage` values into operator-facing phases and derives the
 * cockpit's readiness score, bottlenecks, and single Next Best Action from real
 * stage counts.
 */
import type { CreatorStage } from "@/lib/lifecycle";

export type PhaseKey =
  | "define"
  | "discover"
  | "qualify"
  | "invite"
  | "gift"
  | "delivered"
  | "content"
  | "amplify"
  | "retain";

export type Phase = {
  key: PhaseKey;
  label: string;
  /** What the operator is trying to accomplish in this phase. */
  purpose: string;
  /** Canonical stages that live in this phase (may be empty for meta phases). */
  stages: CreatorStage[];
};

/**
 * Ordered launch phases mapped onto canonical stages. `define`, `amplify`, and
 * `retain` are operator activities that overlay the pipeline rather than owning a
 * distinct stage (amplification/retention act on `posted`/`paid` creators), so
 * their `stages` intentionally reuse the terminal-success stages.
 */
export const PHASES: Phase[] = [
  { key: "define", label: "Define", purpose: "Lock the brief, goals, and ideal creator rings.", stages: [] },
  { key: "discover", label: "Discover", purpose: "Source and enrich candidate creators.", stages: ["sourced"] },
  { key: "qualify", label: "Qualify", purpose: "Score fit and approve who to invite.", stages: ["review"] },
  { key: "invite", label: "Invite", purpose: "Send curated product-testing invitations.", stages: ["contacted", "replied"] },
  { key: "gift", label: "Gift", purpose: "Ship product once consent + address are in.", stages: ["onboarded"] },
  { key: "delivered", label: "Delivered", purpose: "Confirm delivery and check in.", stages: ["shipped"] },
  { key: "content", label: "Content", purpose: "Review posts, rights, and performance.", stages: ["posted"] },
  { key: "amplify", label: "Amplify", purpose: "Upgrade and boost high performers.", stages: ["paid"] },
  { key: "retain", label: "Retain", purpose: "Turn one-off posters into advocates.", stages: ["paid"] },
];

const STAGE_TO_PHASE = new Map<CreatorStage, PhaseKey>();
for (const p of PHASES) for (const s of p.stages) if (!STAGE_TO_PHASE.has(s)) STAGE_TO_PHASE.set(s, p.key);

/** The launch phase a single creator currently sits in (by stage). */
export function phaseForStage(stage: CreatorStage): PhaseKey {
  return STAGE_TO_PHASE.get(stage) ?? "discover";
}

export type StageCount = { stage: string | null; n: number | string };

function countsByStage(rows: StageCount[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.stage) out[r.stage] = (out[r.stage] ?? 0) + Number(r.n);
  return out;
}

export type CockpitInputs = {
  stageCounts: StageCount[];
  launchDate?: string | Date | null;
  now?: Date;
  /** Operator-confirmed setup items for the Define phase (brief, goals, rings). */
  defineComplete?: boolean;
  /** Number of creators waiting for a human decision (review queue length). */
  reviewQueue?: number;
  /** Pending payout approvals. */
  pendingPayouts?: number;
  /** Creators replied but not yet onboarded (invites needing a nudge/consent). */
  awaitingConsent?: number;
  /** Posts detected but not yet reviewed for rights/performance. */
  contentToReview?: number;
};

export type PhaseChecklistItem = {
  phase: PhaseKey;
  label: string;
  count: number;
  /** done | active | blocked | upcoming */
  state: "done" | "active" | "blocked" | "upcoming";
  owner: string;
  /** Contextual, in-app action link. */
  href: string;
  blocker: string | null;
};

export type Bottleneck = { phase: PhaseKey; label: string; count: number; detail: string };

export type NextBestAction = {
  label: string;
  detail: string;
  href: string;
  phase: PhaseKey;
  /** Higher = more urgent. Used to pick the single winner. */
  priority: number;
};

export type Cockpit = {
  currentPhase: PhaseKey;
  readiness: number; // 0..100 progress toward the launch machine running end-to-end
  daysToLaunch: number | null;
  totals: { discovered: number; inMotion: number; posted: number };
  checklist: PhaseChecklistItem[];
  bottlenecks: Bottleneck[];
  nextBestAction: NextBestAction;
  funnel: FunnelStep[];
};

export type FunnelStep = {
  key: string;
  label: string;
  count: number;
  /** Conversion from the previous step, 0..1, or null for the first step. */
  conversion: number | null;
};

const DAY_MS = 86_400_000;

/**
 * The heart of the cockpit: given real stage counts + a few human-in-loop
 * counters, produce the phase checklist, bottlenecks, readiness %, and the one
 * Next Best Action. Pure and deterministic so it is fully unit-testable.
 */
export function computeCockpit(input: CockpitInputs): Cockpit {
  const now = input.now ?? new Date();
  const c = countsByStage(input.stageCounts);
  const at = (s: CreatorStage) => c[s] ?? 0;

  const discovered = Object.values(c).reduce((a, b) => a + b, 0);
  const posted = at("posted") + at("paid");
  const inMotion = at("sourced") + at("review") + at("contacted") + at("replied") + at("onboarded") + at("shipped");

  const reviewQueue = input.reviewQueue ?? at("review");
  const pendingPayouts = input.pendingPayouts ?? 0;
  const awaitingConsent = input.awaitingConsent ?? at("replied");
  const contentToReview = input.contentToReview ?? 0;

  let daysToLaunch: number | null = null;
  if (input.launchDate) {
    const d = new Date(input.launchDate);
    if (!Number.isNaN(d.getTime())) daysToLaunch = Math.ceil((d.getTime() - now.getTime()) / DAY_MS);
  }

  /* ---- phase checklist ---- */
  const checklist: PhaseChecklistItem[] = [];
  const push = (item: Omit<PhaseChecklistItem, "owner"> & { owner?: string }) =>
    checklist.push({ owner: item.owner ?? "You", ...item });

  push({
    phase: "define",
    label: "Brief, goals & rings defined",
    count: input.defineComplete ? 1 : 0,
    state: input.defineComplete ? "done" : "active",
    href: "/pulse",
    blocker: input.defineComplete ? null : "Confirm the campaign brief and goals",
  });
  push({
    phase: "discover",
    label: "Candidates sourced",
    count: at("sourced"),
    state: discovered > 0 ? (at("sourced") > 0 ? "active" : "done") : "active",
    href: "/discovery",
    blocker: discovered === 0 ? "No creators sourced yet — add or import candidates" : null,
  });
  push({
    phase: "qualify",
    label: "Fit reviewed & approved",
    count: reviewQueue,
    state: reviewQueue > 0 ? "blocked" : discovered > 0 ? "active" : "upcoming",
    href: "/pulse",
    blocker: reviewQueue > 0 ? `${reviewQueue} waiting for your call` : null,
  });
  push({
    phase: "invite",
    label: "Invitations sent",
    count: at("contacted") + at("replied"),
    state: at("contacted") + at("replied") > 0 ? "active" : "upcoming",
    href: "/outreach",
    blocker: null,
  });
  push({
    phase: "gift",
    label: "Gifts shipped after consent",
    count: at("onboarded"),
    state: awaitingConsent > 0 ? "blocked" : at("onboarded") > 0 ? "active" : "upcoming",
    href: "/pulse",
    blocker: awaitingConsent > 0 ? `${awaitingConsent} accepted — need address/consent to ship` : null,
  });
  push({
    phase: "delivered",
    label: "Deliveries confirmed",
    count: at("shipped"),
    state: at("shipped") > 0 ? "active" : "upcoming",
    href: "/pulse",
    blocker: null,
  });
  push({
    phase: "content",
    label: "Content reviewed",
    count: contentToReview || at("posted"),
    state: contentToReview > 0 ? "blocked" : at("posted") > 0 ? "active" : "upcoming",
    href: "/content",
    blocker: contentToReview > 0 ? `${contentToReview} posts to review` : null,
  });
  push({
    phase: "amplify",
    label: "High performers amplified",
    count: pendingPayouts,
    state: pendingPayouts > 0 ? "blocked" : posted > 0 ? "active" : "upcoming",
    href: "/pulse",
    blocker: pendingPayouts > 0 ? `${pendingPayouts} payment${pendingPayouts === 1 ? "" : "s"} to approve` : null,
  });
  push({
    phase: "retain",
    label: "Advocates retained",
    count: at("paid"),
    state: at("paid") > 0 ? "active" : "upcoming",
    href: "/creators",
    blocker: null,
  });

  /* ---- bottlenecks: any blocked checklist item, most-blocking first ---- */
  const bottlenecks: Bottleneck[] = checklist
    .filter((i) => i.state === "blocked")
    .map((i) => ({ phase: i.phase, label: PHASE_LABEL[i.phase], count: i.count, detail: i.blocker ?? "" }))
    .sort((a, b) => b.count - a.count);

  /* ---- current phase: the earliest phase still carrying live creators/work ---- */
  const currentPhase = deriveCurrentPhase(input.defineComplete, c, reviewQueue);

  /* ---- Next Best Action: highest-priority thing a human should do now ---- */
  const candidates: NextBestAction[] = [];
  if (!input.defineComplete)
    candidates.push({ label: "Define the campaign brief & goals", detail: "Confirm PULSE goals and creator rings before sourcing.", href: "/pulse", phase: "define", priority: 100 });
  if (pendingPayouts > 0)
    candidates.push({ label: `Approve ${pendingPayouts} payment${pendingPayouts === 1 ? "" : "s"}`, detail: "Creators are waiting on sign-off for posted, disclosed reviews.", href: "/pulse", phase: "amplify", priority: 95 });
  if (reviewQueue > 0)
    candidates.push({ label: `Review ${reviewQueue} creator${reviewQueue === 1 ? "" : "s"}`, detail: "Approve or pass on the ranked qualification queue.", href: "/pulse", phase: "qualify", priority: 90 });
  if (contentToReview > 0)
    candidates.push({ label: `Review ${contentToReview} new post${contentToReview === 1 ? "" : "s"}`, detail: "Check rights, quality, and performance; decide repost/amplify.", href: "/content", phase: "content", priority: 80 });
  if (awaitingConsent > 0)
    candidates.push({ label: `Follow up with ${awaitingConsent} who replied`, detail: "They said yes — nudge for the address form so gifting can start.", href: "/inbox", phase: "gift", priority: 70 });
  if (discovered === 0)
    candidates.push({ label: "Add your first creators", detail: "Import a Modash CSV or paste handles to start the pipeline.", href: "/pulse", phase: "discover", priority: 60 });
  else if (at("sourced") > 0)
    candidates.push({ label: "Let enrichment finish sourcing", detail: `${at("sourced")} candidates are being enriched and ranked.`, href: "/pulse", phase: "discover", priority: 30 });

  candidates.push({ label: "Add more creators", detail: "Keep the top of the funnel full to hit the launch goal.", href: "/pulse", phase: "discover", priority: 10 });
  const nextBestAction = candidates.sort((a, b) => b.priority - a.priority)[0];

  /* ---- readiness: weighted completeness of the launch machine ---- */
  const readiness = computeReadiness({ defineComplete: !!input.defineComplete, discovered, reviewQueue, invited: at("contacted") + at("replied"), shipped: at("shipped") + at("onboarded"), posted, blocked: bottlenecks.length });

  return {
    currentPhase,
    readiness,
    daysToLaunch,
    totals: { discovered, inMotion, posted },
    checklist,
    bottlenecks,
    nextBestAction,
    funnel: buildFunnel(c),
  };
}

const PHASE_LABEL: Record<PhaseKey, string> = Object.fromEntries(
  PHASES.map((p) => [p.key, p.label]),
) as Record<PhaseKey, string>;

function deriveCurrentPhase(
  defineComplete: boolean | undefined,
  c: Record<string, number>,
  reviewQueue: number,
): PhaseKey {
  if (!defineComplete) return "define";
  const at = (s: string) => c[s] ?? 0;
  if (reviewQueue > 0) return "qualify";
  if (at("posted") > 0 || at("paid") > 0) return "content";
  if (at("shipped") > 0) return "delivered";
  if (at("onboarded") > 0 || at("replied") > 0) return "gift";
  if (at("contacted") > 0) return "invite";
  if (at("sourced") > 0) return "discover";
  return "discover";
}

function computeReadiness(x: {
  defineComplete: boolean;
  discovered: number;
  reviewQueue: number;
  invited: number;
  shipped: number;
  posted: number;
  blocked: number;
}): number {
  // Each milestone contributes once the machine has proven it can run that step.
  let r = 0;
  if (x.defineComplete) r += 15;
  if (x.discovered > 0) r += 20;
  if (x.discovered - x.reviewQueue > 0 || x.invited > 0) r += 15; // something got qualified
  if (x.invited > 0) r += 20;
  if (x.shipped > 0) r += 15;
  if (x.posted > 0) r += 15;
  // Unresolved bottlenecks shave a little off to reflect "needs attention".
  r -= Math.min(10, x.blocked * 3);
  return Math.max(0, Math.min(100, r));
}

/** Narrowing funnel with step-over-step conversion. */
function buildFunnel(c: Record<string, number>): FunnelStep[] {
  const at = (s: string) => c[s] ?? 0;
  const discovered = Object.values(c).reduce((a, b) => a + b, 0);
  const contacted = at("contacted") + at("replied") + at("onboarded") + at("shipped") + at("posted") + at("paid");
  const replied = at("replied") + at("onboarded") + at("shipped") + at("posted") + at("paid");
  const shipped = at("shipped") + at("posted") + at("paid");
  const posted = at("posted") + at("paid");
  const raw: Array<{ key: string; label: string; count: number }> = [
    { key: "discovered", label: "Discovered", count: discovered },
    { key: "contacted", label: "Invited", count: contacted },
    { key: "replied", label: "Replied", count: replied },
    { key: "shipped", label: "Shipped", count: shipped },
    { key: "posted", label: "Posted", count: posted },
  ];
  return raw.map((step, i) => {
    const prev = i === 0 ? null : raw[i - 1].count;
    const conversion = prev && prev > 0 ? step.count / prev : i === 0 ? null : 0;
    return { ...step, conversion };
  });
}
