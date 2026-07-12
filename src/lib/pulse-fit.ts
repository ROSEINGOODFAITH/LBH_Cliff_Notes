/**
 * PULSE campaign-specific creator fit scoring.
 *
 * This is a DIFFERENT, complementary layer to the learned `model.ts` weights.
 * `model.ts` learns David's approve/reject taste and produces `creators.fitScore`
 * (the review-queue rank). This module is an explainable, fixed-rubric score out
 * of 100 tailored to the PULSE launch brief, per the campaign spec:
 *
 *   audience / category fit   30
 *   content quality / originality 25
 *   buying-intent comments    20
 *   authentic category history 15
 *   consistency               10
 *
 * It never invents data: every missing input lowers confidence and is reported
 * in `missing[]` rather than silently assumed. It only reasons over content /
 * aesthetic categories — NEVER inferred sensitive traits.
 */

export type FitInput = {
  handle?: string | null;
  followerCount?: number | null;
  engagementRate?: number | null; // 0..1 fraction (repo convention)
  avgViews?: number | null;
  fakeFollowerPct?: number | null; // 0..100
  geo?: string | null;
  niche?: string | null;
  nicheTags?: string[] | null;
  aestheticScore?: number | null; // 0..100 (Claude brand-fit)
  /** Optional manual/enrichment signals the operator or a job may attach. */
  signals?: FitSignals | null;
};

export type FitSignals = {
  /** Count of comments showing buying intent ("where can I get this", "link?"). */
  buyingIntentComments?: number | null;
  /** Prior authentic posts in a PULSE-adjacent category (fragrance/beauty/etc). */
  categoryPostCount?: number | null;
  /** Posting cadence, posts per week over the trailing window. */
  postsPerWeek?: number | null;
  /** Operator override: hard-flag a creator as affiliate spam. */
  manualSpamFlag?: boolean | null;
};

export type FitComponent = {
  key: "audience" | "content" | "buyingIntent" | "categoryHistory" | "consistency";
  label: string;
  score: number;
  max: number;
  /** True when the input needed to score this dimension was absent. */
  estimated: boolean;
};

export type SpamRisk = {
  /** 0..1 — higher is riskier. */
  level: number;
  flag: boolean; // level >= FLAG threshold OR a manual flag
  reasons: string[];
};

export type PulseFit = {
  score: number; // 0..100 after spam penalty
  baseScore: number; // 0..100 before spam penalty
  components: FitComponent[];
  spamRisk: SpamRisk;
  /** Aesthetic/content angle tags matched from niche data (never sensitive traits). */
  tags: PulseAngle[];
  /** The single best angle to lead outreach with, or null if none matched. */
  angle: PulseAngle | null;
  rationale: string[];
  missing: string[];
  /** How much of the rubric was backed by real data (0..1). */
  confidence: number;
};

/* ---------------------------------------------------------------------------
 * PULSE aesthetic angles — content/style categories only. These map creator
 * niche keywords onto the launch's art direction (floral+grape fragrance;
 * Lycra / 1980s jazzercise / Jane Fonda workout energy; leopard as power).
 * These are NOT sensitive-trait inferences; "nightlife" here means the
 * club/party *content* aesthetic, matched only from self-declared niche tags.
 * ------------------------------------------------------------------------- */
export type PulseAngle = {
  key: string;
  label: string;
  /** One-line hook an operator can drop into outreach. */
  hook: string;
};

export const PULSE_ANGLES: PulseAngle[] = [
  { key: "fragrance", label: "Fragrance", hook: "a floral-grape scent story for the fragrance-obsessed" },
  { key: "beauty", label: "Beauty", hook: "a scent that finishes the getting-ready ritual" },
  { key: "fashion_80s", label: "'80s fashion", hook: "high-shine, Lycra-era styling energy" },
  { key: "dance_fitness", label: "Dance / fitness", hook: "Jane Fonda-era aerobic power in a bottle" },
  { key: "maximalist", label: "Maximalist style", hook: "loud, leopard-print maximalism" },
  { key: "leopard_power", label: "Leopard / power dressing", hook: "leopard as a symbol of power" },
  { key: "nightlife", label: "Nightlife culture", hook: "a scent built for the dancefloor" },
];

/** niche keyword → angle key. Keys are matched as case-insensitive substrings. */
const ANGLE_KEYWORDS: Record<string, string> = {
  fragrance: "fragrance",
  perfume: "fragrance",
  scent: "fragrance",
  fragrancetok: "fragrance",
  perfumetok: "fragrance",
  beauty: "beauty",
  grwm: "beauty",
  makeup: "beauty",
  skincare: "beauty",
  "80s": "fashion_80s",
  eighties: "fashion_80s",
  retro: "fashion_80s",
  vintage: "fashion_80s",
  aerobics: "dance_fitness",
  jazzercise: "dance_fitness",
  dance: "dance_fitness",
  fitness: "dance_fitness",
  workout: "dance_fitness",
  gym: "dance_fitness",
  maximalist: "maximalist",
  maximalism: "maximalist",
  colorful: "maximalist",
  leopard: "leopard_power",
  "animal print": "leopard_power",
  power: "leopard_power",
  nightlife: "nightlife",
  club: "nightlife",
  rave: "nightlife",
  party: "nightlife",
};

/** Niches that count as "authentic PULSE-adjacent category history". */
const CATEGORY_HISTORY_ANGLES = new Set(["fragrance", "beauty", "maximalist", "fashion_80s"]);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Match PULSE aesthetic angles from a creator's niche + tags (content only). */
export function matchAngles(input: FitInput): PulseAngle[] {
  const haystack = [input.niche ?? "", ...(input.nicheTags ?? [])]
    .join(" ")
    .toLowerCase();
  const keys = new Set<string>();
  for (const [kw, angleKey] of Object.entries(ANGLE_KEYWORDS)) {
    if (haystack.includes(kw)) keys.add(angleKey);
  }
  return PULSE_ANGLES.filter((a) => keys.has(a.key));
}

const SPAM_FLAG_THRESHOLD = 0.5;

/**
 * Affiliate-spam risk from available signals. Deliberately conservative and
 * fully explained — every point of risk has a stated reason so the operator can
 * overrule it. A manual flag is absolute.
 */
export function spamRisk(input: FitInput): SpamRisk {
  const reasons: string[] = [];
  let level = 0;

  if (input.signals?.manualSpamFlag) {
    return { level: 1, flag: true, reasons: ["Manually flagged as affiliate spam"] };
  }

  const fake = input.fakeFollowerPct;
  if (fake != null) {
    if (fake >= 35) {
      level += 0.4;
      reasons.push(`High fake-follower rate (${Math.round(fake)}%)`);
    } else if (fake >= 20) {
      level += 0.2;
      reasons.push(`Elevated fake-follower rate (${Math.round(fake)}%)`);
    }
  }

  // Engagement that is near-zero on a large following is a classic bought-audience
  // / mass-affiliate tell.
  const er = input.engagementRate;
  const followers = input.followerCount ?? 0;
  if (er != null && followers >= 20_000 && er < 0.005) {
    level += 0.25;
    reasons.push("Very low engagement for audience size");
  }

  // Views far below followers suggest an inflated or inactive audience.
  if (input.avgViews != null && followers >= 50_000 && input.avgViews < followers * 0.02) {
    level += 0.15;
    reasons.push("Average views far below follower count");
  }

  // Generic, handle-farm style usernames (e.g. lots of trailing digits) correlate
  // with throwaway affiliate accounts. Weak signal, small weight.
  const handle = (input.handle ?? "").replace(/^@+/, "");
  if (handle && /\d{4,}$/.test(handle)) {
    level += 0.1;
    reasons.push("Handle looks auto-generated (long numeric suffix)");
  }

  level = clamp(level, 0, 1);
  return { level, flag: level >= SPAM_FLAG_THRESHOLD, reasons };
}

/**
 * Explainable PULSE fit score out of 100. Missing inputs are scored at a neutral
 * partial credit and reported (not assumed positive), and lower `confidence`.
 */
export function pulseFit(input: FitInput): PulseFit {
  const missing: string[] = [];
  const rationale: string[] = [];
  const angles = matchAngles(input);
  const s = input.signals ?? {};

  /* --- audience / category fit (30) --- */
  // Blend audience-size fit (micro/mid sweet spot), US geo, and how many PULSE
  // angles the creator's content already matches.
  let audience = 0;
  const followers = input.followerCount;
  if (followers == null) {
    missing.push("follower count");
    audience += 6; // neutral partial credit out of 12
  } else if (followers >= 10_000 && followers < 200_000) {
    audience += 12; // ideal reach band for seeding
    rationale.push("Reach in the ideal 10k–200k seeding band");
  } else if (followers >= 5_000 && followers < 500_000) {
    audience += 8;
  } else {
    audience += 3;
    rationale.push(followers < 5_000 ? "Small audience for reach" : "Very large audience — less nimble for seeding");
  }
  if (input.geo == null) {
    missing.push("audience geo");
    audience += 3; // neutral out of 6
  } else if (input.geo === "US") {
    audience += 6;
    rationale.push("US audience");
  } else {
    audience += 2;
  }
  const angleFit = Math.min(angles.length, 3) * 4; // up to 12 for 3+ matched angles
  audience += angleFit;
  if (angles.length) rationale.push(`On-brief aesthetic: ${angles.map((a) => a.label).join(", ")}`);
  else missing.push("niche / content tags");
  audience = clamp(Math.round(audience), 0, 30);

  /* --- content quality / originality (25) --- */
  let content = 0;
  const aesthetic = input.aestheticScore;
  if (aesthetic == null) {
    missing.push("aesthetic score");
    content += 12; // neutral out of 25
  } else {
    content += Math.round((aesthetic / 100) * 25);
    rationale.push(aesthetic >= 70 ? "Strong brand-fit aesthetic" : aesthetic >= 45 ? "Workable aesthetic" : "Weak brand-fit aesthetic");
  }
  content = clamp(content, 0, 25);

  /* --- buying-intent comments (20) --- */
  let buyingIntent = 0;
  const bic = s.buyingIntentComments;
  if (bic == null) {
    missing.push("buying-intent comment signal");
    // Fall back to engagement as a weak proxy so this isn't a total blank.
    const er = input.engagementRate;
    if (er == null) {
      buyingIntent += 6;
    } else if (er >= 0.05) {
      buyingIntent += 12;
      rationale.push("High engagement (proxy for buying intent)");
    } else if (er >= 0.03) {
      buyingIntent += 9;
    } else {
      buyingIntent += 4;
    }
  } else if (bic >= 10) {
    buyingIntent += 20;
    rationale.push("Comments show strong buying intent");
  } else if (bic >= 3) {
    buyingIntent += 14;
    rationale.push("Some buying-intent comments");
  } else {
    buyingIntent += 6;
  }
  buyingIntent = clamp(buyingIntent, 0, 20);

  /* --- authentic category history (15) --- */
  let categoryHistory = 0;
  const cpc = s.categoryPostCount;
  const hasCategoryAngle = angles.some((a) => CATEGORY_HISTORY_ANGLES.has(a.key));
  if (cpc == null) {
    missing.push("category post history");
    categoryHistory += hasCategoryAngle ? 9 : 5; // lean on angle match as a proxy
    if (hasCategoryAngle) rationale.push("Content categories align with fragrance/beauty");
  } else if (cpc >= 5) {
    categoryHistory += 15;
    rationale.push("Consistent authentic category history");
  } else if (cpc >= 1) {
    categoryHistory += 9;
  } else {
    categoryHistory += 2;
  }
  categoryHistory = clamp(categoryHistory, 0, 15);

  /* --- consistency (10) --- */
  let consistency = 0;
  const ppw = s.postsPerWeek;
  if (ppw == null) {
    missing.push("posting cadence");
    consistency += 5; // neutral out of 10
  } else if (ppw >= 3) {
    consistency += 10;
    rationale.push("Posts consistently (3+/week)");
  } else if (ppw >= 1) {
    consistency += 7;
  } else {
    consistency += 2;
    rationale.push("Posts infrequently");
  }
  consistency = clamp(consistency, 0, 10);

  const components: FitComponent[] = [
    { key: "audience", label: "Audience & category fit", score: audience, max: 30, estimated: followers == null || input.geo == null || !angles.length },
    { key: "content", label: "Content quality & originality", score: content, max: 25, estimated: aesthetic == null },
    { key: "buyingIntent", label: "Buying-intent signal", score: buyingIntent, max: 20, estimated: bic == null },
    { key: "categoryHistory", label: "Authentic category history", score: categoryHistory, max: 15, estimated: cpc == null },
    { key: "consistency", label: "Posting consistency", score: consistency, max: 10, estimated: ppw == null },
  ];

  const baseScore = clamp(
    components.reduce((sum, c) => sum + c.score, 0),
    0,
    100,
  );

  const risk = spamRisk(input);
  // Spam risk discounts the score proportionally (up to -50%), rather than
  // zeroing it — an operator can still choose to look.
  const score = clamp(Math.round(baseScore * (1 - risk.level * 0.5)), 0, 100);
  if (risk.flag) rationale.push(`Affiliate-spam risk: ${risk.reasons.join("; ")}`);

  const estimatedCount = components.filter((c) => c.estimated).length;
  const confidence = clamp(1 - estimatedCount / components.length, 0, 1);

  return {
    score,
    baseScore,
    components,
    spamRisk: risk,
    tags: angles,
    angle: angles[0] ?? null,
    rationale,
    missing,
    confidence,
  };
}
