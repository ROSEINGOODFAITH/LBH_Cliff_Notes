import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creators, events, importBatches, importRows } from "@/db/schema";
import type { NewCreator } from "@/lib/creators";
import {
  parseImportFile,
  buildPreview,
  fileHash,
  checkSize,
  defaultImportStage,
  type ExistingCreatorLite,
  type FieldTarget,
  type ChangeField,
  type ParsedRow,
} from "@/lib/csv-import";

/**
 * Apply an import. This is the ONLY place the importer writes.
 *
 * Safety guarantees (mirrored from the screenshot-confirm flow):
 *   - Idempotent: a batch is keyed by the file's content hash (unique). Re-posting
 *     the same file collides and returns the ORIGINAL batch's counts without
 *     touching a single creator again.
 *   - Enrichment fills EMPTY fields only. A row is only applied when the server's
 *     re-computed preview classifies it `enriched` (no unresolved conflicts) or
 *     `created` (operator opted in). Conflict/skipped/error/unchanged rows are
 *     recorded but never applied.
 *   - Never sends/schedules email, never advances or sets `stage` on an existing
 *     creator, never sets a tier, never creates a gift, never starts a flow. New
 *     creators are inserted at the earliest stage (`sourced`) with no tier.
 */

/** Columns a change may target — each maps 1:1 to a `creators` column. */
const APPLICABLE_FIELDS: ChangeField[] = [
  "displayName",
  "email",
  "followerCount",
  "engagementRate",
  "geo",
  "notes",
  "nicheTags",
  "primaryPlatform",
  "audienceAge",
  "audienceGeo",
];

interface ExistingFull extends ExistingCreatorLite {
  sourceMetadata: unknown;
}

async function loadExisting(): Promise<ExistingFull[]> {
  return db
    .select({
      id: creators.id,
      handle: creators.handle,
      primaryPlatform: creators.primaryPlatform,
      email: creators.email,
      externalId: creators.externalId,
      displayName: creators.displayName,
      followerCount: creators.followerCount,
      engagementRate: creators.engagementRate,
      geo: creators.geo,
      notes: creators.notes,
      nicheTags: creators.nicheTags,
      audienceAge: creators.audienceAge,
      audienceGeo: creators.audienceGeo,
      sourceMetadata: creators.sourceMetadata,
    })
    .from(creators);
}

/** Fallback identity for a NEW creator's required handle. */
function deriveHandle(row: ParsedRow): string | null {
  if (row.handle) return row.handle;
  if (row.urlHandles.length) return row.urlHandles[0];
  if (row.emails.length) return row.emails[0].split("@")[0];
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const csvText = typeof body.csvText === "string" ? body.csvText : "";
  const filename = typeof body.filename === "string" && body.filename.trim() ? body.filename.trim() : "upload.csv";
  const operator = typeof body.operator === "string" && body.operator.trim() ? body.operator.trim() : null;
  if (!csvText.trim()) return NextResponse.json({ error: "csvText is required." }, { status: 400 });

  const mapping: Record<string, FieldTarget> | undefined =
    body.mapping && typeof body.mapping === "object" ? body.mapping : undefined;
  const createNew = body.createNew === true;
  const overrides: Record<string, ChangeField[]> =
    body.overrides && typeof body.overrides === "object" ? body.overrides : {};

  const hash = fileHash(csvText);
  const byteLength = Buffer.byteLength(csvText, "utf8");
  const parsed = parseImportFile(csvText, mapping);
  const size = checkSize(byteLength, parsed.rows.length);
  if (!size.ok) return NextResponse.json({ error: size.error }, { status: 413 });

  // Idempotency gate: claim the file hash. A losing insert means this exact file
  // was already imported — return the original batch, apply nothing.
  const [batch] = await db
    .insert(importBatches)
    .values({
      filename,
      fileHash: hash,
      operator,
      source: "csv",
      status: "completed",
      totalRows: parsed.rows.length,
      mapping: parsed.mapping,
    })
    .onConflictDoNothing({ target: importBatches.fileHash })
    .returning({ id: importBatches.id });

  if (!batch) {
    const [prior] = await db.select().from(importBatches).where(eq(importBatches.fileHash, hash)).limit(1);
    return NextResponse.json({
      ok: true,
      replay: true,
      batchId: prior?.id ?? null,
      summary: prior
        ? {
            total: prior.totalRows,
            enriched: prior.enrichedCount,
            created: prior.createdCount,
            skipped: prior.skippedCount,
            conflict: prior.conflictCount,
            error: prior.errorCount,
            unchanged: prior.unchangedCount,
          }
        : null,
      message: "This exact file was already imported — nothing was changed.",
    });
  }

  const existing = await loadExisting();
  const preview = buildPreview(parsed.rows, existing, { createNew, overrides });
  const existingById = new Map(existing.map((e) => [e.id, e]));

  let enriched = 0,
    created = 0;

  for (let i = 0; i < preview.rows.length; i++) {
    const pr = preview.rows[i];
    const src = parsed.rows[i];
    let appliedCreatorId: string | null = pr.creatorId;
    let applied = false;

    if (pr.outcome === "enriched" && pr.creatorId) {
      // conflicts=[] guarantees every change is fill-empty or an approved override.
      const patch: Record<string, unknown> = { updatedAt: new Date(), lastEnrichedAt: new Date() };
      for (const c of pr.changes) {
        if (APPLICABLE_FIELDS.includes(c.field)) patch[c.field] = c.to;
      }
      const prev = existingById.get(pr.creatorId)?.sourceMetadata;
      const prevObj = prev && typeof prev === "object" ? (prev as Record<string, unknown>) : {};
      patch.sourceMetadata = { ...prevObj, import: { batchId: batch.id, filename, rowHash: src.rowHash } };
      await db.update(creators).set(patch as Partial<NewCreator>).where(eq(creators.id, pr.creatorId));
      applied = true;
      enriched++;
    } else if (pr.outcome === "created") {
      const handle = deriveHandle(src);
      if (!handle) {
        pr.outcome = "error";
        pr.errors = [...pr.errors, "No usable handle for a new creator."];
      } else {
        const values: NewCreator = {
          handle,
          primaryPlatform: src.platform,
          email: src.emails[0] ?? null,
          displayName: src.core.displayName,
          followerCount: src.core.followerCount,
          engagementRate: src.core.engagementRate,
          geo: src.core.geo,
          notes: src.core.notes,
          nicheTags: src.core.nicheTags,
          audienceAge: src.core.audienceAge,
          audienceGeo: src.core.audienceGeo,
          source: "csv",
          stage: defaultImportStage(),
          sourceMetadata: { import: { batchId: batch.id, filename, rowHash: src.rowHash }, ...src.metadata },
        };
        const [row] = await db.insert(creators).values(values).returning({ id: creators.id });
        appliedCreatorId = row.id;
        applied = true;
        created++;
        await db.insert(events).values({
          creatorId: row.id,
          type: "import.creator.created",
          payload: { batchId: batch.id, source: "csv", stage: defaultImportStage() },
        });
      }
    }

    await db
      .insert(importRows)
      .values({
        batchId: batch.id,
        rowIndex: pr.index,
        rowHash: pr.rowHash,
        outcome: pr.outcome,
        matchReason: pr.matchReason,
        matchConfidence: pr.matchConfidence,
        creatorId: appliedCreatorId,
        proposedChanges: pr.changes.length
          ? Object.fromEntries(pr.changes.map((c) => [c.field, { from: c.from, to: c.to, conflict: c.conflict }]))
          : null,
        applied,
        error: pr.errors[0] ?? null,
      })
      .onConflictDoNothing({ target: [importRows.batchId, importRows.rowHash] });
  }

  const summary = {
    total: preview.rows.length,
    enriched,
    created,
    skipped: preview.rows.filter((r) => r.outcome === "skipped").length,
    conflict: preview.rows.filter((r) => r.outcome === "conflict").length,
    error: preview.rows.filter((r) => r.outcome === "error").length,
    unchanged: preview.rows.filter((r) => r.outcome === "unchanged").length,
  };

  await db
    .update(importBatches)
    .set({
      enrichedCount: summary.enriched,
      createdCount: summary.created,
      skippedCount: summary.skipped,
      conflictCount: summary.conflict,
      errorCount: summary.error,
      unchangedCount: summary.unchanged,
      completedAt: new Date(),
    })
    .where(eq(importBatches.id, batch.id));

  return NextResponse.json({ ok: true, replay: false, batchId: batch.id, summary });
}
