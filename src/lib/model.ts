// PULSE weighted-feature model — non-negotiable per master prompt §1.
// NOTE: adapted to repo conventions — engagementRate is a 0..1 fraction
// (0.034 = 3.4%) and follower count lives on `followerCount`.
const NICHES = ["fragrance", "beauty", "lifestyle", "grwm", "fitness", "fashion", "skincare", "unboxing"];

export type CreatorLike = {
  engagementRate: number | null; // 0..1 fraction
  followerCount: number | null;
  fakeFollowerPct: number | null; // 0..100
  geo: string | null;
  niche: string | null;
  aestheticScore: number | null;
  avgViews: number | null;
};

export function extractFeatures(c: CreatorLike): Record<string, number> {
  const er = c.engagementRate ?? 0, f = c.followerCount ?? 0, av = c.avgViews ?? 0;
  return {
    er_high: er > 0.05 ? 1 : 0,
    er_mid: er >= 0.03 && er <= 0.05 ? 1 : 0,
    micro: f < 50_000 ? 1 : 0,
    mid: f >= 50_000 && f < 200_000 ? 1 : 0,
    macro: f >= 200_000 ? 1 : 0,
    fake_low: (c.fakeFollowerPct ?? 100) < 15 ? 1 : 0,
    us: c.geo === "US" ? 1 : 0,
    ...Object.fromEntries(NICHES.map((n) => ["n_" + n, c.niche === n ? 1 : 0])),
    aesthetic: (c.aestheticScore ?? 50) / 100,
    views_ratio: f ? Math.min(av / f, 2) / 2 : 0,
  };
}

export function fitScore(c: CreatorLike, weights: Record<string, number>): number {
  const feats = extractFeatures(c);
  let s = 0;
  for (const k in feats) s += (weights[k] ?? 0) * feats[k];
  return Math.max(0, Math.min(100, Math.round(50 + s * 10)));
}

/** label: 1 = approved (tier_a/tier_b), 0 = reject. Decaying learning rate. */
export function updateWeights(
  weights: Record<string, number>, features: Record<string, number>, label: 0 | 1, decisionCount: number,
): Record<string, number> {
  const lr = 0.4 / (1 + decisionCount * 0.02);
  const next = { ...weights };
  for (const k in features) next[k] = (next[k] ?? 0) + lr * (label - 0.5) * 2 * features[k];
  return next;
}

/** CPM heuristic per §6: avgViews × $25 CPM / 1000, capped $500, floor $75. */
export function suggestedRateUsd(avgViews: number | null): number {
  return Math.min(500, Math.max(75, Math.round(((avgViews ?? 0) * 25) / 1000)));
}
