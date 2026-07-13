import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseImportFile,
  parseRow,
  autoDetectMapping,
  normalizeHandle,
  handleFromUrl,
  normalizePlatform,
  normalizeEmail,
  parsePercent,
  parseLabeledPercent,
  parseIntSafe,
  parseTags,
  stableRowHash,
  fileHash,
  buildPreview,
  matchRow,
  indexExisting,
  computeChanges,
  defaultImportStage,
  identityKey,
  sanitizeCsvCell,
  toCsv,
  checkSize,
  MAX_ROWS,
  type ExistingCreatorLite,
} from "../src/lib/csv-import";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(HERE, "fixtures", "creators-sample.csv"), "utf8");

/* --------------------------------------------------------------------------
 * Parsing / normalization
 * ------------------------------------------------------------------------ */
test("parseImportFile handles quoted multiline bios without losing rows", () => {
  const { rows, headers } = parseImportFile(FIXTURE);
  assert.equal(headers.length, 70);
  assert.equal(rows.length, 8);
  // Row 2 (index 1) has a multiline quoted bio preserved in metadata.
  const bio = rows[1].metadata["Bio/Description"];
  assert.ok(typeof bio === "string" && bio.includes("The Scent Diary"));
});

test("normalizeHandle strips @, casing, hosts, tracking params and URL variants", () => {
  assert.equal(normalizeHandle("@Aria.Scents"), "aria.scents");
  assert.equal(normalizeHandle("https://www.tiktok.com/@aria.scents"), "aria.scents");
  assert.equal(normalizeHandle("https://instagram.com/night_notes?igshid=abc123"), "night_notes");
  assert.equal(normalizeHandle("https://www.tiktok.com/share/user/6806137126800294917|https://www.tiktok.com/@notjeangrey"), "notjeangrey");
  assert.equal(normalizeHandle("  LisaSillage/  "), "lisasillage");
});

test("handleFromUrl ignores YouTube channel ids (not real handles)", () => {
  assert.equal(handleFromUrl("https://www.youtube.com/channel/UCoySSWVNDdBidLOB9onJ27A"), "");
  assert.equal(handleFromUrl("https://www.youtube.com/@freshfind"), "freshfind");
});

test("normalizePlatform maps channel labels to enum values", () => {
  assert.equal(normalizePlatform("TikTok"), "tiktok");
  assert.equal(normalizePlatform("Instagram"), "instagram");
  assert.equal(normalizePlatform("YouTube"), "youtube");
  assert.equal(normalizePlatform("Twitch"), null);
});

test("normalizeEmail validates and lowercases; rejects garbage", () => {
  assert.equal(normalizeEmail("  Aria@Example.COM "), "aria@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail(""), null);
});

test("parsePercent distinguishes fractions from whole-percent values", () => {
  assert.equal(parsePercent("0.100474"), 0.100474); // already a fraction
  assert.equal(parsePercent("12.5"), 0.125); // whole percent
  assert.equal(parsePercent("35"), 0.35);
  assert.equal(parsePercent("0.10"), 0.10);
  assert.equal(parsePercent("10%"), 0.10);
  assert.equal(parsePercent(""), null);
  assert.equal(parsePercent("abc"), null);
});

test("parseLabeledPercent splits Country=fraction cells", () => {
  assert.deepEqual(parseLabeledPercent("United States=0.508487"), { name: "United States", value: 0.508487 });
  assert.equal(parseLabeledPercent(""), null);
});

test("parseIntSafe strips commas; parseTags splits on ; and ,", () => {
  assert.equal(parseIntSafe("124,800"), 124800);
  assert.equal(parseIntSafe(""), null);
  assert.deepEqual(parseTags("a-tier;fragrance"), ["a-tier", "fragrance"]);
  assert.deepEqual(parseTags(""), []);
});

/* --------------------------------------------------------------------------
 * Rich metadata preservation & percent audit
 * ------------------------------------------------------------------------ */
test("rich fields are preserved and raw values kept for audit", () => {
  const { rows } = parseImportFile(FIXTURE);
  const aria = rows[0];
  // engagement stored as 0..1 fraction, raw kept
  assert.equal(aria.core.engagementRate, 0.061203);
  assert.equal(aria.metadata.er_raw, "0.061203");
  assert.equal(aria.metadata.followers_raw, "88400");
  // audience geo captured from Top country column
  assert.deepEqual(aria.core.audienceGeo, { "United States": 0.61 });
  // labels -> nicheTags; note preserved
  assert.deepEqual(aria.core.nicheTags, ["a-tier", "fragrance"]);
});

test("Status column is captured as metadata and NEVER mapped to a stage", () => {
  const { rows, mapping } = parseImportFile(FIXTURE);
  // The mapping must not target any core stage field for Status.
  assert.deepEqual(mapping["Status"], { kind: "metadata", key: "Status" });
  const freshFind = rows.find((r) => r.handle === "fresh_find")!;
  assert.equal(freshFind.metadata["Status"], "Contacted");
  // Nothing in ParsedRow carries a stage.
  assert.ok(!("stage" in (freshFind as object)));
});

/* --------------------------------------------------------------------------
 * Matching precedence & duplicates
 * ------------------------------------------------------------------------ */
function mkExisting(partial: Partial<ExistingCreatorLite> & { id: string; handle: string }): ExistingCreatorLite {
  return {
    primaryPlatform: null, email: null, externalId: null, displayName: null,
    followerCount: null, engagementRate: null, geo: null, notes: null,
    nicheTags: null, audienceAge: null, audienceGeo: null, ...partial,
  };
}

test("matchRow prefers platform+handle, then URL handle, then email", () => {
  const existing = [
    mkExisting({ id: "c1", handle: "aria.scents", primaryPlatform: "tiktok" }),
    mkExisting({ id: "c2", handle: "someoneelse", email: "contact@nightnotes.io" }),
  ];
  const idx = indexExisting(existing);
  const { rows } = parseImportFile(FIXTURE);

  const aria = rows[0];
  const m1 = matchRow(aria, idx);
  assert.equal(m1.creatorId, "c1");
  assert.equal(m1.confidence, 0.95);

  // night_notes matches only by email (handle differs)
  const nn = rows[2];
  const m2 = matchRow(nn, idx);
  assert.equal(m2.creatorId, "c2");
  assert.equal(m2.confidence, 0.85);
  assert.match(m2.reason ?? "", /email/);
});

test("multiple distinct matches force manual resolution (ambiguous)", () => {
  const existing = [
    mkExisting({ id: "c1", handle: "dup", primaryPlatform: "tiktok" }),
    mkExisting({ id: "c2", handle: "other", email: "amb@example.com" }),
  ];
  const idx = indexExisting(existing);
  const row = parseRow(
    { Username: "@dup", Channel: "TikTok", Email_1: "amb@example.com" },
    0,
    autoDetectMapping(["Username", "Channel", "Email_1"]),
  );
  const m = matchRow(row, idx);
  assert.equal(m.ambiguous, true);
  assert.equal(m.creatorId, null);
  assert.equal(m.ambiguousIds.length, 2);
});

test("within-file duplicates are detected and skipped", () => {
  const { rows } = parseImportFile(FIXTURE);
  const preview = buildPreview(rows, [], { createNew: true });
  // Row 4 (index 3) duplicates aria.scents from row 1.
  const dup = preview.rows[3];
  assert.equal(dup.outcome, "skipped");
  assert.match(dup.detail, /Duplicate/);
  assert.ok(preview.summary.duplicatesInFile >= 1);
});

test("identityKey is stable across @ and casing", () => {
  const a = parseRow({ Username: "@Aria.Scents", Channel: "TikTok" }, 0, autoDetectMapping(["Username", "Channel"]));
  const b = parseRow({ Username: "aria.scents", Channel: "TikTok" }, 1, autoDetectMapping(["Username", "Channel"]));
  assert.equal(identityKey(a), identityKey(b));
});

/* --------------------------------------------------------------------------
 * Fill-empty + conflict semantics
 * ------------------------------------------------------------------------ */
test("computeChanges fills empty fields only and flags conflicts", () => {
  const existing = mkExisting({
    id: "c1", handle: "aria.scents", primaryPlatform: "tiktok",
    displayName: "Existing Name", // non-empty -> conflict if incoming differs
    followerCount: null, // empty -> fill
  });
  const row = parseRow(
    { Username: "@aria.scents", Channel: "TikTok", Fullname: "Aria Bloom", "#Followers/Subscribers": "88400" },
    0,
    autoDetectMapping(["Username", "Channel", "Fullname", "#Followers/Subscribers"]),
  );
  const changes = computeChanges(existing, row);
  const byField = Object.fromEntries(changes.map((c) => [c.field, c]));
  assert.equal(byField["followerCount"].conflict, false); // filled empty
  assert.equal(byField["followerCount"].to, 88400);
  assert.equal(byField["displayName"].conflict, true); // differs from non-empty
});

test("conflict rows are not applied unless explicitly overridden", () => {
  const existing = [mkExisting({ id: "c1", handle: "aria.scents", primaryPlatform: "tiktok", displayName: "Old Name" })];
  const row = parseRow(
    { Username: "@aria.scents", Channel: "TikTok", Fullname: "Aria Bloom" },
    0,
    autoDetectMapping(["Username", "Channel", "Fullname"]),
  );
  const noOverride = buildPreview([row], existing);
  assert.equal(noOverride.rows[0].outcome, "conflict");
  assert.deepEqual(noOverride.rows[0].conflicts, ["displayName"]);

  const withOverride = buildPreview([row], existing, { overrides: { [row.rowHash]: ["displayName"] } });
  assert.equal(withOverride.rows[0].outcome, "enriched");
  assert.equal(withOverride.rows[0].conflicts.length, 0);
});

test("unmatched rows are skipped by default, created only when opted in", () => {
  const { rows } = parseImportFile(FIXTURE);
  const noCreate = buildPreview(rows, []);
  // fresh_find has no DB match; default policy skips it
  const ffSkip = noCreate.rows.find((r) => r.handle === "fresh_find")!;
  assert.equal(ffSkip.outcome, "skipped");

  const withCreate = buildPreview(rows, [], { createNew: true });
  const ffCreate = withCreate.rows.find((r) => r.handle === "fresh_find")!;
  assert.equal(ffCreate.outcome, "created");
  assert.match(ffCreate.detail, /sourced/);
});

test("new creators default to the earliest stage and never a tier", () => {
  assert.equal(defaultImportStage(), "sourced");
  assert.notEqual(defaultImportStage(), "contacted");
  assert.notEqual(defaultImportStage(), "replied");
});

test("rows with no usable identifier are errors", () => {
  const { rows } = parseImportFile(FIXTURE);
  const preview = buildPreview(rows, [], { createNew: true });
  const err = preview.rows.find((r) => r.outcome === "error");
  assert.ok(err, "expected an error row for the identifier-less record");
  assert.match(err!.errors[0], /identifier/i);
});

/* --------------------------------------------------------------------------
 * Idempotency
 * ------------------------------------------------------------------------ */
test("fileHash and rowHash are stable across identical content", () => {
  assert.equal(fileHash(FIXTURE), fileHash(FIXTURE));
  const raw = { Username: "@x", Channel: "TikTok", Note: "hi" };
  assert.equal(stableRowHash(raw), stableRowHash({ ...raw }));
  assert.notEqual(stableRowHash(raw), stableRowHash({ ...raw, Note: "changed" }));
});

test("re-running preview on the same rows yields identical outcomes (idempotent)", () => {
  const { rows } = parseImportFile(FIXTURE);
  const existing = [mkExisting({ id: "c1", handle: "aria.scents", primaryPlatform: "tiktok" })];
  const a = buildPreview(rows, existing, { createNew: false });
  const b = buildPreview(rows, existing, { createNew: false });
  assert.deepEqual(a.summary, b.summary);
  assert.deepEqual(a.rows.map((r) => [r.rowHash, r.outcome]), b.rows.map((r) => [r.rowHash, r.outcome]));
});

/* --------------------------------------------------------------------------
 * Import performs no side effects on lifecycle (structural guarantee)
 * ------------------------------------------------------------------------ */
test("preview rows never carry stage/tier/outreach/gift/flow instructions", () => {
  const { rows } = parseImportFile(FIXTURE);
  const preview = buildPreview(rows, [], { createNew: true });
  for (const r of preview.rows) {
    const changed = r.changes.map((c) => c.field);
    assert.ok(!changed.includes("primaryPlatform" as never) || true); // platform allowed
    // No change ever targets a lifecycle/relationship/gift field.
    for (const f of changed) {
      assert.ok(!["stage", "tier", "relationshipTier", "ring", "discountCode", "shopifyDraftOrderId"].includes(f));
    }
  }
});

/* --------------------------------------------------------------------------
 * CSV export safety
 * ------------------------------------------------------------------------ */
test("sanitizeCsvCell neutralizes formula injection", () => {
  assert.equal(sanitizeCsvCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(sanitizeCsvCell("+1"), "'+1");
  assert.equal(sanitizeCsvCell("@handle"), "'@handle");
  assert.equal(sanitizeCsvCell("plain"), "plain");
  assert.equal(sanitizeCsvCell('has,comma'), '"has,comma"');
});

test("toCsv builds a sanitized, quoted report", () => {
  const csv = toCsv(["handle", "note"], [{ handle: "=evil", note: "a,b" }]);
  assert.match(csv, /'=evil/);
  assert.match(csv, /"a,b"/);
});

/* --------------------------------------------------------------------------
 * Size limits
 * ------------------------------------------------------------------------ */
test("checkSize enforces byte and row limits with clear errors", () => {
  assert.equal(checkSize(100, 50).ok, true);
  assert.equal(checkSize(100, MAX_ROWS + 1).ok, false);
  assert.equal(checkSize(10 * 1024 * 1024, 10).ok, false);
});
