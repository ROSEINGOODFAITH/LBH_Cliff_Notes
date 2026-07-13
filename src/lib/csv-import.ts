/**
 * CSV creator import — provider-neutral, pure helpers.
 *
 * The cardinal rules (mirrored from the screenshot-ingestion flow):
 *   - Upload/preview NEVER writes. Everything here is a pure computation over
 *     parsed rows + a snapshot of existing creators; persistence happens only in
 *     the confirm route.
 *   - Enrichment fills EMPTY fields only. A non-empty existing value is never
 *     silently overwritten — a differing incoming value becomes a CONFLICT the
 *     operator must resolve with an explicit override.
 *   - Importing never moves a creator's canonical `stage`, never sets a tier,
 *     never touches campaign/outreach/gift/flow state. The CSV `Status` column is
 *     captured as metadata only and is deliberately NOT mapped to a stage.
 *   - New creators (only when the operator opts in) default to `sourced`, no tier.
 *   - Re-uploading the same file is idempotent: a stable file hash + per-row hash
 *     let the confirm route skip replays instead of creating duplicates.
 */
import { createHash } from "node:crypto";
import { parseCsv } from "@/lib/csv";
import type { CreatorStage } from "@/lib/lifecycle";

/* ===========================================================================
 * Canonical target fields we allow a CSV to populate on `creators`.
 * Everything else on a row is preserved verbatim in provider-neutral metadata.
 * ========================================================================= */
export type CoreField =
  | "handle"
  | "displayName"
  | "email"
  | "primaryPlatform"
  | "followerCount"
  | "engagementRate"
  | "geo"
  | "notes"
  | "nicheTags"
  | "audienceAge"
  | "audienceGeo";

export type Platform = "instagram" | "tiktok" | "youtube";

/** Default canonical stage for a NEWLY created creator from an import. */
export function defaultImportStage(): CreatorStage {
  return "sourced";
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------------------------------------------------------------------------
 * Header → field mapping for the known export shape. Unknown headers fall
 * through to metadata. The operator can override the mapping in the UI.
 * ------------------------------------------------------------------------- */
export type FieldTarget =
  | { kind: "core"; field: CoreField }
  | { kind: "identity"; field: "accountUrl" }
  | { kind: "emailCandidate" }
  | { kind: "platformUrl"; platform: string }
  | { kind: "audienceAge"; bucket: string }
  | { kind: "audienceGender"; bucket: string }
  | { kind: "audienceCountry"; rank: number }
  | { kind: "metadata"; key: string }
  | { kind: "ignore" };

/** The exact export headers we recognise automatically. */
export const KNOWN_HEADER_MAP: Record<string, FieldTarget> = {
  Username: { kind: "core", field: "handle" },
  Channel: { kind: "core", field: "primaryPlatform" },
  "Account URL": { kind: "identity", field: "accountUrl" },
  Country: { kind: "core", field: "geo" },
  Fullname: { kind: "core", field: "displayName" },
  "#Followers/Subscribers": { kind: "core", field: "followerCount" },
  "%ER": { kind: "core", field: "engagementRate" },
  Note: { kind: "core", field: "notes" },
  Labels: { kind: "core", field: "nicheTags" },
  Email_1: { kind: "core", field: "email" },
  Email_2: { kind: "emailCandidate" },
  Email_3: { kind: "emailCandidate" },
  "%13-17": { kind: "audienceAge", bucket: "13-17" },
  "%18-24": { kind: "audienceAge", bucket: "18-24" },
  "%25-34": { kind: "audienceAge", bucket: "25-34" },
  "%35-44": { kind: "audienceAge", bucket: "35-44" },
  "%Male": { kind: "audienceGender", bucket: "male" },
  "%Female": { kind: "audienceGender", bucket: "female" },
  "%Top1_Cntr": { kind: "audienceCountry", rank: 1 },
  "%Top2_Cntr": { kind: "audienceCountry", rank: 2 },
  "%Top3_Cntr": { kind: "audienceCountry", rank: 3 },
  Instagram: { kind: "platformUrl", platform: "instagram" },
  YouTube: { kind: "platformUrl", platform: "youtube" },
  TikTok: { kind: "platformUrl", platform: "tiktok" },
  Twitch: { kind: "platformUrl", platform: "twitch" },
  X: { kind: "platformUrl", platform: "x" },
  Facebook: { kind: "platformUrl", platform: "facebook" },
};

/** Build the effective mapping for a set of headers (known → typed, else metadata). */
export function autoDetectMapping(headers: string[]): Record<string, FieldTarget> {
  const out: Record<string, FieldTarget> = {};
  for (const h of headers) {
    const key = h.trim();
    out[h] = KNOWN_HEADER_MAP[key] ?? { kind: "metadata", key };
  }
  return out;
}

/* ===========================================================================
 * Normalisation
 * ========================================================================= */
const HOSTS =
  /^https?:\/\/(www\.)?(m\.)?(tiktok\.com\/(share\/user\/\d+\|?)?@?|instagram\.com\/|youtube\.com\/(channel\/|c\/|user\/)?@?|youtu\.be\/)/i;

/** Lowercased handle with URL/host/@/query stripped. Provider-neutral. */
export function normalizeHandle(input: string): string {
  let h = (input ?? "").trim();
  if (!h) return "";
  // If multiple pipe-separated URLs (export lists share + canonical), take the last.
  if (h.includes("|")) h = h.split("|").filter(Boolean).pop() ?? h;
  h = h
    .replace(HOSTS, "")
    .replace(/[?#/].*$/, "")
    .replace(/^@+/, "")
    .trim()
    .toLowerCase();
  return h;
}

/** Extract a normalized handle from an account/profile URL, if any. */
export function handleFromUrl(url: string): string {
  const n = normalizeHandle(url);
  // YouTube channel ids (UC…) are not handles — ignore for matching.
  if (/^uc[a-z0-9_-]{20,}$/i.test(n)) return "";
  return n;
}

/** Map a channel/platform label to a canonical platform enum value, or null. */
export function normalizePlatform(input: string): Platform | null {
  const p = (input ?? "").trim().toLowerCase();
  if (p === "instagram" || p === "ig") return "instagram";
  if (p === "tiktok" || p === "tik tok") return "tiktok";
  if (p === "youtube" || p === "yt") return "youtube";
  return null;
}

export function normalizeEmail(input: string): string | null {
  const e = (input ?? "").trim().toLowerCase();
  if (!e) return null;
  return EMAIL_RE.test(e) ? e : null;
}

/**
 * Parse a percentage cell to a 0..1 fraction (repo convention). Distinguishes a
 * decimal fraction (0.10 → 0.10) from a whole-percent (10 → 0.10). Returns null
 * for blanks/garbage. The caller keeps the raw string for audit.
 */
export function parsePercent(input: string): number | null {
  let s = (input ?? "").trim();
  if (!s) return null;
  const hadPercentSign = s.includes("%");
  s = s.replace(/%/g, "").trim();
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0) return null;
  // "10%" or "10" (>1) are whole-percent; 0.10 stays a fraction.
  let frac = v > 1 ? v / 100 : v;
  if (hadPercentSign && v <= 1 && v > 0) frac = v / 100; // "0.5%" -> 0.005
  return frac;
}

/** "United States=0.508487" → { name, value(0..1) }. */
export function parseLabeledPercent(input: string): { name: string; value: number | null } | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const i = s.lastIndexOf("=");
  if (i === -1) return { name: s, value: null };
  return { name: s.slice(0, i).trim(), value: parsePercent(s.slice(i + 1)) };
}

export function parseIntSafe(input: string): number | null {
  const s = (input ?? "").replace(/[, ]/g, "").trim();
  if (!s) return null;
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v) : null;
}

/** Split a labels/notes cell into tags on ; or , trimming blanks. */
export function parseTags(input: string): string[] {
  return (input ?? "")
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/* ===========================================================================
 * Parsed row model
 * ========================================================================= */
export interface ParsedRow {
  index: number;
  handle: string | null;
  platform: Platform | null;
  accountUrl: string | null;
  /** Handles derived from account/platform URLs, for URL-based matching. */
  urlHandles: string[];
  emails: string[]; // validated, normalized, primary first
  core: {
    displayName: string | null;
    followerCount: number | null;
    engagementRate: number | null;
    geo: string | null;
    notes: string | null;
    nicheTags: string[] | null;
    audienceAge: Record<string, number> | null;
    audienceGeo: Record<string, number> | null;
  };
  /** Everything preserved for audit (raw + rich fields). */
  metadata: Record<string, unknown>;
  /** Fatal per-row problems (row cannot be applied). */
  errors: string[];
  rowHash: string;
}

export function stableRowHash(raw: Record<string, string>): string {
  const keys = Object.keys(raw).sort();
  const canon = keys.map((k) => `${k}=${(raw[k] ?? "").trim()}`).join("");
  return createHash("sha256").update(canon).digest("hex").slice(0, 32);
}

export function fileHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Turn one raw CSV record into a normalized ParsedRow using the mapping. */
export function parseRow(
  raw: Record<string, string>,
  index: number,
  mapping: Record<string, FieldTarget>,
): ParsedRow {
  let handle: string | null = null;
  let platform: Platform | null = null;
  let accountUrl: string | null = null;
  const urlHandles: string[] = [];
  const emails: string[] = [];
  const audienceAge: Record<string, number> = {};
  const audienceGeo: Record<string, number> = {};
  const metadata: Record<string, unknown> = {};
  const core: ParsedRow["core"] = {
    displayName: null,
    followerCount: null,
    engagementRate: null,
    geo: null,
    notes: null,
    nicheTags: null,
    audienceAge: null,
    audienceGeo: null,
  };

  for (const [header, target] of Object.entries(mapping)) {
    const value = (raw[header] ?? "").trim();
    switch (target.kind) {
      case "ignore":
        break;
      case "metadata":
        if (value) metadata[target.key] = value;
        break;
      case "identity": // accountUrl
        if (value) {
          accountUrl = value;
          const h = handleFromUrl(value);
          if (h) urlHandles.push(h);
        }
        break;
      case "platformUrl":
        if (value) {
          metadata[`url_${target.platform}`] = value;
          const h = handleFromUrl(value);
          if (h) urlHandles.push(h);
        }
        break;
      case "emailCandidate": {
        const e = normalizeEmail(value);
        if (e && !emails.includes(e)) emails.push(e);
        else if (value) metadata[`email_invalid_${header}`] = value;
        break;
      }
      case "audienceAge": {
        const v = parsePercent(value);
        if (v != null) audienceAge[target.bucket] = v;
        break;
      }
      case "audienceGender": {
        const v = parsePercent(value);
        if (v != null) metadata[`audience_gender_${target.bucket}`] = v;
        break;
      }
      case "audienceCountry": {
        const parsed = parseLabeledPercent(value);
        if (parsed && parsed.value != null) audienceGeo[parsed.name] = parsed.value;
        break;
      }
      case "core": {
        switch (target.field) {
          case "handle":
            if (value) handle = normalizeHandle(value);
            break;
          case "primaryPlatform":
            platform = normalizePlatform(value);
            if (value && !platform) metadata.channel_raw = value;
            break;
          case "email": {
            const e = normalizeEmail(value);
            if (e) emails.unshift(e); // primary candidate first
            else if (value) metadata.email_1_invalid = value;
            break;
          }
          case "displayName":
            core.displayName = value || null;
            break;
          case "followerCount":
            core.followerCount = parseIntSafe(value);
            if (value) metadata.followers_raw = value;
            break;
          case "engagementRate":
            core.engagementRate = parsePercent(value);
            if (value) metadata.er_raw = value;
            break;
          case "geo":
            core.geo = value || null;
            break;
          case "notes":
            core.notes = value || null;
            break;
          case "nicheTags": {
            const tags = parseTags(value);
            core.nicheTags = tags.length ? tags : null;
            break;
          }
          default:
            break;
        }
        break;
      }
    }
  }

  // de-dup emails preserving order (primary first)
  const seenE = new Set<string>();
  const emailsDedup = emails.filter((e) => (seenE.has(e) ? false : (seenE.add(e), true)));

  core.audienceAge = Object.keys(audienceAge).length ? audienceAge : null;
  core.audienceGeo = Object.keys(audienceGeo).length ? audienceGeo : null;

  // If platform is unknown but the account URL reveals it, infer it.
  if (!platform && accountUrl) {
    if (/tiktok\.com/i.test(accountUrl)) platform = "tiktok";
    else if (/instagram\.com/i.test(accountUrl)) platform = "instagram";
    else if (/youtube\.com|youtu\.be/i.test(accountUrl)) platform = "youtube";
  }

  const errors: string[] = [];
  const hasIdentity = Boolean(handle || urlHandles.length || emailsDedup.length);
  if (!hasIdentity) errors.push("No usable identifier (handle, account URL, or email).");

  return {
    index,
    handle: handle || null,
    platform,
    accountUrl,
    urlHandles: Array.from(new Set(urlHandles)),
    emails: emailsDedup,
    core,
    metadata,
    errors,
    rowHash: stableRowHash(raw),
  };
}

/** Parse a whole file into normalized rows. Pure over the raw text. */
export function parseImportFile(
  rawText: string,
  mapping?: Record<string, FieldTarget>,
): { rows: ParsedRow[]; headers: string[]; mapping: Record<string, FieldTarget> } {
  const records = parseCsv(rawText);
  const headers = records.length ? Object.keys(records[0]) : [];
  const map = mapping ?? autoDetectMapping(headers);
  const rows = records.map((r, i) => parseRow(r, i, map));
  return { rows, headers, mapping: map };
}

/* ===========================================================================
 * Matching against existing creators
 * ========================================================================= */
export interface ExistingCreatorLite {
  id: string;
  handle: string;
  primaryPlatform: string | null;
  email: string | null;
  externalId: string | null;
  displayName: string | null;
  followerCount: number | null;
  engagementRate: number | null;
  geo: string | null;
  notes: string | null;
  nicheTags: string[] | null;
  audienceAge: unknown;
  audienceGeo: unknown;
}

export interface MatchResult {
  creatorId: string | null;
  reason: string | null;
  confidence: number | null;
  /** More than one distinct existing creator matched — needs manual resolution. */
  ambiguous: boolean;
  ambiguousIds: string[];
}

interface Indexed {
  byHandlePlatform: Map<string, string>; // `${platform}:${handle}` -> id
  byHandle: Map<string, string[]>; // handle -> ids (any platform)
  byEmail: Map<string, string>; // email -> id
}

export function indexExisting(existing: ExistingCreatorLite[]): Indexed {
  const byHandlePlatform = new Map<string, string>();
  const byHandle = new Map<string, string[]>();
  const byEmail = new Map<string, string>();
  for (const c of existing) {
    const h = normalizeHandle(c.handle);
    if (h) {
      if (c.primaryPlatform) byHandlePlatform.set(`${c.primaryPlatform}:${h}`, c.id);
      const arr = byHandle.get(h) ?? [];
      if (!arr.includes(c.id)) arr.push(c.id);
      byHandle.set(h, arr);
    }
    const e = normalizeEmail(c.email ?? "");
    if (e) byEmail.set(e, c.id);
  }
  return { byHandlePlatform, byHandle, byEmail };
}

/**
 * Match one parsed row, in descending confidence:
 *   platform+handle exact (0.95) → URL-derived handle (0.9) → email (0.85) →
 *   handle-only, no platform on the row (0.6). If distinct matches disagree, the
 *   row is ambiguous and must be resolved by hand.
 */
export function matchRow(row: ParsedRow, idx: Indexed): MatchResult {
  const hits: Array<{ id: string; reason: string; confidence: number }> = [];

  if (row.handle && row.platform) {
    const id = idx.byHandlePlatform.get(`${row.platform}:${row.handle}`);
    if (id) hits.push({ id, reason: `handle @${row.handle} on ${row.platform}`, confidence: 0.95 });
  }
  for (const uh of row.urlHandles) {
    const ids = idx.byHandle.get(uh);
    if (ids) for (const id of ids) hits.push({ id, reason: `profile URL handle @${uh}`, confidence: 0.9 });
  }
  for (const e of row.emails) {
    const id = idx.byEmail.get(e);
    if (id) hits.push({ id, reason: `email ${e}`, confidence: 0.85 });
  }
  if (row.handle && !row.platform) {
    const ids = idx.byHandle.get(row.handle);
    if (ids) for (const id of ids) hits.push({ id, reason: `handle @${row.handle} (platform unknown)`, confidence: 0.6 });
  }

  if (hits.length === 0) return { creatorId: null, reason: null, confidence: null, ambiguous: false, ambiguousIds: [] };

  const distinct = Array.from(new Set(hits.map((h) => h.id)));
  if (distinct.length > 1) {
    return { creatorId: null, reason: "Matches multiple existing creators", confidence: null, ambiguous: true, ambiguousIds: distinct };
  }
  const best = hits.sort((a, b) => b.confidence - a.confidence)[0];
  return { creatorId: best.id, reason: best.reason, confidence: best.confidence, ambiguous: false, ambiguousIds: [] };
}

/* ===========================================================================
 * Change computation (fill-empty + conflict detection)
 * ========================================================================= */
export type ChangeField =
  | "displayName"
  | "email"
  | "followerCount"
  | "engagementRate"
  | "geo"
  | "notes"
  | "nicheTags"
  | "primaryPlatform"
  | "audienceAge"
  | "audienceGeo";

export interface FieldChange {
  field: ChangeField;
  from: unknown;
  to: unknown;
  /** Existing value is non-empty AND differs — needs explicit override to apply. */
  conflict: boolean;
}

function emptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function eq(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/**
 * Compute the proposed changes for a matched creator. Fill-empty only:
 *   - existing empty + incoming present  → fill (not a conflict)
 *   - existing present + incoming differs → CONFLICT (skipped unless overridden)
 *   - existing present + incoming equal/empty → no change
 */
export function computeChanges(existing: ExistingCreatorLite, row: ParsedRow): FieldChange[] {
  const incoming: Array<{ field: ChangeField; value: unknown; current: unknown }> = [
    { field: "displayName", value: row.core.displayName, current: existing.displayName },
    { field: "email", value: row.emails[0] ?? null, current: existing.email },
    { field: "followerCount", value: row.core.followerCount, current: existing.followerCount },
    { field: "engagementRate", value: row.core.engagementRate, current: existing.engagementRate },
    { field: "geo", value: row.core.geo, current: existing.geo },
    { field: "notes", value: row.core.notes, current: existing.notes },
    { field: "nicheTags", value: row.core.nicheTags, current: existing.nicheTags },
    { field: "primaryPlatform", value: row.platform, current: existing.primaryPlatform },
    { field: "audienceAge", value: row.core.audienceAge, current: existing.audienceAge },
    { field: "audienceGeo", value: row.core.audienceGeo, current: existing.audienceGeo },
  ];
  const changes: FieldChange[] = [];
  for (const { field, value, current } of incoming) {
    if (emptyValue(value)) continue; // nothing to contribute
    if (emptyValue(current)) {
      changes.push({ field, from: current ?? null, to: value, conflict: false });
    } else if (!eq(current, value)) {
      changes.push({ field, from: current, to: value, conflict: true });
    }
  }
  return changes;
}

/* ===========================================================================
 * Preview (per-row outcome + summary)
 * ========================================================================= */
export type RowOutcome = "enriched" | "created" | "skipped" | "conflict" | "error" | "unchanged";

export interface PreviewRow {
  index: number;
  rowHash: string;
  handle: string | null;
  platform: Platform | null;
  emails: string[];
  outcome: RowOutcome;
  creatorId: string | null;
  matchReason: string | null;
  matchConfidence: number | null;
  changes: FieldChange[];
  /** Fields that conflict and therefore require an explicit override to apply. */
  conflicts: ChangeField[];
  errors: string[];
  detail: string;
}

export interface PreviewOptions {
  /** Create creators for unmatched rows. Default OFF (favor enrichment). */
  createNew?: boolean;
  /** rowHash → fields the operator explicitly approved overwriting. */
  overrides?: Record<string, ChangeField[]>;
}

export interface PreviewSummary {
  total: number;
  enriched: number;
  created: number;
  skipped: number;
  conflict: number;
  error: number;
  unchanged: number;
  duplicatesInFile: number;
}

export interface Preview {
  rows: PreviewRow[];
  summary: PreviewSummary;
}

/** Stable identity key for within-file duplicate detection. */
export function identityKey(row: ParsedRow): string | null {
  if (row.handle && row.platform) return `hp:${row.platform}:${row.handle}`;
  if (row.handle) return `h:${row.handle}`;
  if (row.urlHandles.length) return `u:${[...row.urlHandles].sort().join(",")}`;
  if (row.emails.length) return `e:${row.emails[0]}`;
  return null;
}

/**
 * Build the full preview: match every row, compute changes, classify outcome.
 * Pure — never writes. The confirm route re-runs this server-side with the
 * operator's options before applying, so client input is never trusted.
 */
export function buildPreview(
  rows: ParsedRow[],
  existing: ExistingCreatorLite[],
  options: PreviewOptions = {},
): Preview {
  const idx = indexExisting(existing);
  const overrides = options.overrides ?? {};
  const seen = new Set<string>();
  let duplicatesInFile = 0;

  const out: PreviewRow[] = rows.map((row) => {
    const base = {
      index: row.index,
      rowHash: row.rowHash,
      handle: row.handle,
      platform: row.platform,
      emails: row.emails,
      creatorId: null as string | null,
      matchReason: null as string | null,
      matchConfidence: null as number | null,
      changes: [] as FieldChange[],
      conflicts: [] as ChangeField[],
      errors: row.errors,
    };

    if (row.errors.length) {
      return { ...base, outcome: "error", detail: row.errors[0] };
    }

    // within-file duplicate
    const key = identityKey(row);
    if (key) {
      if (seen.has(key)) {
        duplicatesInFile++;
        return { ...base, outcome: "skipped", detail: "Duplicate of an earlier row in this file." };
      }
      seen.add(key);
    }

    const match = matchRow(row, idx);
    if (match.ambiguous) {
      return {
        ...base,
        outcome: "conflict",
        matchReason: match.reason,
        detail: `Matches ${match.ambiguousIds.length} existing creators — resolve by hand.`,
      };
    }

    if (match.creatorId) {
      const existingRow = existing.find((e) => e.id === match.creatorId)!;
      const changes = computeChanges(existingRow, row);
      const approved = new Set(overrides[row.rowHash] ?? []);
      const conflicts = changes.filter((c) => c.conflict && !approved.has(c.field)).map((c) => c.field);
      const applicable = changes.filter((c) => !c.conflict || approved.has(c.field));
      const outcome: RowOutcome = conflicts.length
        ? "conflict"
        : applicable.length
          ? "enriched"
          : "unchanged";
      return {
        ...base,
        outcome,
        creatorId: match.creatorId,
        matchReason: match.reason,
        matchConfidence: match.confidence,
        changes,
        conflicts,
        detail:
          outcome === "conflict"
            ? `${conflicts.length} field(s) differ from existing — override to apply.`
            : outcome === "enriched"
              ? `Fill ${applicable.length} empty field(s).`
              : "No new information.",
      };
    }

    // No match → create only if operator opted in.
    if (options.createNew) {
      return { ...base, outcome: "created", detail: "New creator (stage: sourced, no tier)." };
    }
    return { ...base, outcome: "skipped", detail: "No match — enable 'Create new creators' to add." };
  });

  const summary: PreviewSummary = {
    total: out.length,
    enriched: out.filter((r) => r.outcome === "enriched").length,
    created: out.filter((r) => r.outcome === "created").length,
    skipped: out.filter((r) => r.outcome === "skipped").length,
    conflict: out.filter((r) => r.outcome === "conflict").length,
    error: out.filter((r) => r.outcome === "error").length,
    unchanged: out.filter((r) => r.outcome === "unchanged").length,
    duplicatesInFile,
  };
  return { rows: out, summary };
}

/* ===========================================================================
 * CSV export (error/conflict report) — with formula-injection sanitisation.
 * ========================================================================= */
/** Neutralise spreadsheet formula injection (=, +, -, @, tab, CR) in a cell. */
export function sanitizeCsvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const head = headers.map((h) => sanitizeCsvCell(h)).join(",");
  const body = rows.map((r) => headers.map((h) => sanitizeCsvCell(r[h])).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}

/* ===========================================================================
 * Limits
 * ========================================================================= */
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_ROWS = 10_000;

export interface SizeCheck {
  ok: boolean;
  error?: string;
}

export function checkSize(byteLength: number, rowCount: number): SizeCheck {
  if (byteLength > MAX_FILE_BYTES)
    return { ok: false, error: `File is too large (${Math.round(byteLength / 1024)} KB; limit ${MAX_FILE_BYTES / 1024 / 1024} MB).` };
  if (rowCount > MAX_ROWS) return { ok: false, error: `Too many rows (${rowCount}; limit ${MAX_ROWS}).` };
  return { ok: true };
}
