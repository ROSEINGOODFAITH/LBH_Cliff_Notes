import { getEnv, integrations } from "@/lib/env";

/**
 * Modash Discovery API client (https://api.modash.io/v1, Bearer auth).
 * Endpoints used:
 *   POST /{platform}/search                    — filtered creator search (-> lookalikes[])
 *   GET  /{platform}/profile/{userId}/report   — full enrichment (1 credit)
 *   POST /collaborations/posts                 — creators linked to a brand (0.2 credit)
 *   GET  /{platform}/{interests|locations|brands} — dictionaries for filter ids
 *
 * Guardrails: every call goes through retry/backoff; dictionaries are cached;
 * enrichment is gated by a 30-day rule at the call site (creators.modashLastEnrichedAt).
 */

const BASE = "https://api.modash.io/v1";

export type ModashPlatform = "instagram" | "tiktok" | "youtube";

export class ModashError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = "ModashError";
    this.status = status;
    this.body = body;
  }
}

export class ModashNotConfiguredError extends ModashError {
  constructor() {
    super("Modash is not configured. Set MODASH_API_KEY.");
    this.name = "ModashNotConfiguredError";
  }
}

export function modashConfigured(): boolean {
  try {
    return integrations.modash();
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function modashFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  { retries = 4, baseDelayMs = 500 }: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const env = getEnv();
  if (!env.MODASH_API_KEY) throw new ModashNotConfiguredError();

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.MODASH_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });

    if (res.status !== 429 && res.status < 500) {
      const text = await res.text();
      if (!res.ok) throw new ModashError(`Modash ${res.status}`, res.status, text.slice(0, 500));
      const json = text ? JSON.parse(text) : null;
      if (json && json.error) {
        throw new ModashError("Modash returned error: true", res.status, text.slice(0, 500));
      }
      return json as T;
    }

    if (attempt >= retries) {
      const text = await res.text();
      throw new ModashError(`Modash ${res.status} (retries exhausted)`, res.status, text.slice(0, 500));
    }
    const ra = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(ra) && ra > 0 ? ra * 1000 : baseDelayMs * 2 ** attempt + Math.random() * 200;
    await sleep(delay);
    attempt += 1;
  }
}

/* ----------------------------- Types we consume ----------------------------- */
export interface ModashProfileBrief {
  userId?: string;
  fullname?: string;
  username: string;
  url?: string;
  picture?: string;
  followers?: number;
  engagements?: number;
  engagementRate?: number;
}
export interface ModashLookalike {
  userId: string;
  profile: ModashProfileBrief;
}
export interface ModashSearchResponse {
  error?: boolean;
  total?: number;
  lookalikes?: ModashLookalike[];
  directs?: ModashLookalike[];
  isExactMatch?: boolean;
}

export interface ModashSearchFilter {
  influencer?: {
    followers?: { min?: number; max?: number };
    engagementRate?: number;
    location?: number[];
    language?: string;
    relevance?: string[];
    gender?: "MALE" | "FEMALE" | "KNOWN" | "UNKNOWN";
    age?: { min?: number; max?: number };
    keywords?: string;
    interests?: number[];
    brands?: number[];
    hasContactDetails?: { contactType: string; filterAction?: "must" | "should" | "not" }[];
    engagements?: { min?: number; max?: number };
  };
  audience?: {
    location?: { id: number; weight?: number }[];
    language?: { id: string; weight?: number };
    gender?: { id: "MALE" | "FEMALE"; weight?: number };
    age?: { id: string; weight?: number }[];
    interests?: { id: number; weight?: number }[];
    credibility?: number;
  };
}

export interface ModashSearchBody {
  page?: number;
  calculationMethod?: "median" | "average";
  sort?: { field: string; value?: number; direction?: "asc" | "desc" };
  filter?: ModashSearchFilter;
}

/* ------------------------------- API methods ------------------------------- */
export function searchCreators(platform: ModashPlatform, body: ModashSearchBody) {
  return modashFetch<ModashSearchResponse>(`/${platform}/search`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getProfileReport(
  platform: ModashPlatform,
  userIdOrHandle: string,
  calculationMethod?: "median" | "average",
) {
  const q = calculationMethod ? `?calculationMethod=${calculationMethod}` : "";
  return modashFetch<Record<string, unknown>>(
    `/${platform}/profile/${encodeURIComponent(userIdOrHandle)}/report${q}`,
    { method: "GET" },
  );
}

export interface CollaborationPostsBody {
  id: string; // brand username / id / profile url
  platform: ModashPlatform;
  collaboratorId?: string;
  limit?: number;
  cursor?: string;
  groupBrandCollaborations?: boolean;
}
export function getCollaborationPosts(body: CollaborationPostsBody) {
  return modashFetch<Record<string, unknown>>(`/collaborations/posts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ------------------------------ Dictionaries ------------------------------- */
const dictCache = new Map<string, { at: number; data: unknown }>();
const DICT_TTL_MS = 1000 * 60 * 60 * 12; // 12h

async function dictionary(platform: ModashPlatform, kind: "interests" | "locations" | "brands" | "languages", query?: string) {
  const key = `${platform}:${kind}:${query ?? ""}`;
  const hit = dictCache.get(key);
  if (hit && Date.now() - hit.at < DICT_TTL_MS) return hit.data;
  const q = query ? `?query=${encodeURIComponent(query)}` : "";
  const data = await modashFetch(`/${platform}/${kind}${q}`, { method: "GET" });
  dictCache.set(key, { at: Date.now(), data });
  return data;
}
export const listInterests = (p: ModashPlatform, q?: string) => dictionary(p, "interests", q);
export const listLocations = (p: ModashPlatform, q?: string) => dictionary(p, "locations", q);
export const listBrands = (p: ModashPlatform, q?: string) => dictionary(p, "brands", q);

/* ------------------------------ Normalizers -------------------------------- */
export interface NormalizedCreator {
  modashUserId: string | null;
  handle: string;
  displayName: string | null;
  url: string | null;
  avatarUrl: string | null;
  followers: number | null;
  engagementRate: number | null;
}

function profileUrl(platform: ModashPlatform, handle: string): string {
  switch (platform) {
    case "instagram":
      return `https://www.instagram.com/${handle}/`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "youtube":
      return `https://www.youtube.com/@${handle}`;
  }
}

export function normalizeLookalike(l: ModashLookalike, platform: ModashPlatform): NormalizedCreator {
  const p = l.profile ?? ({} as ModashProfileBrief);
  return {
    modashUserId: l.userId ?? p.userId ?? null,
    handle: p.username,
    displayName: p.fullname ?? null,
    url: p.url ?? (p.username ? profileUrl(platform, p.username) : null),
    avatarUrl: p.picture ?? null,
    followers: typeof p.followers === "number" ? p.followers : null,
    engagementRate: typeof p.engagementRate === "number" ? p.engagementRate : null,
  };
}

/* --------------------------- Enrichment extractor -------------------------- */
export interface EnrichmentFields {
  handle: string | null;
  displayName: string | null;
  followerCount: number | null;
  engagementRate: number | null;
  avatarUrl: string | null;
  email: string | null;
  nicheTags: string[] | null;
  audienceGeo: unknown | null;
  audienceAge: unknown | null;
  modashId: string | null;
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Defensive: tolerates missing fields, never throws on shape drift. */
export function extractEnrichment(report: Record<string, any>): EnrichmentFields {
  const p = report?.profile ?? {};
  const pp = p?.profile ?? {};
  const contacts: Array<{ type?: string; value?: string }> = Array.isArray(p?.contacts) ? p.contacts : [];
  const email = contacts.find((c) => c?.type === "email")?.value ?? null;
  const interests: Array<{ name?: string }> = Array.isArray(p?.interests) ? p.interests : [];
  const nicheTags = interests.map((i) => i?.name).filter((n): n is string => Boolean(n));
  return {
    handle: pp?.username ?? null,
    displayName: pp?.fullname ?? null,
    followerCount: numOrNull(pp?.followers),
    engagementRate: numOrNull(pp?.engagementRate),
    avatarUrl: pp?.picture ?? null,
    email,
    nicheTags: nicheTags.length ? nicheTags.slice(0, 8) : null,
    audienceGeo: p?.audience?.geoCountries ?? null,
    audienceAge: p?.audience?.ages ?? null,
    modashId: p?.userId ?? pp?.userId ?? null,
  };
}

/* ----------------- Competitor-collaboration candidate extractor ------------ */
export interface DiscoveredCandidate {
  modashUserId: string | null;
  handle: string;
  platform: ModashPlatform;
  url: string | null;
  collaborationType: string | null;
  raw: unknown;
}

/** Pull the influencers who collaborated with a brand from a /collaborations/posts response. */
export function extractCandidatesFromCollaborations(
  json: Record<string, any>,
  requestedPlatform: ModashPlatform,
): DiscoveredCandidate[] {
  const posts: any[] = json?.brand?.posts ?? json?.influencer?.posts ?? [];
  const out: DiscoveredCandidate[] = [];
  for (const post of posts) {
    const username: string | undefined = post?.username;
    const userId: string | undefined = post?.user_id;
    if (!username && !userId) continue;
    const platform = (post?.platform ?? requestedPlatform) as ModashPlatform;
    const handle = username ?? (userId as string);
    out.push({
      modashUserId: userId ?? null,
      handle,
      platform,
      url: username ? profileUrl(platform, username) : null,
      collaborationType: post?.collaboration_type ?? null,
      raw: post,
    });
  }
  return out;
}
