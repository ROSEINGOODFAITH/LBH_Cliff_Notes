import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { creators } from "@/db/schema";
import {
  parseImportFile,
  buildPreview,
  fileHash,
  checkSize,
  toCsv,
  type ExistingCreatorLite,
  type FieldTarget,
  type ChangeField,
} from "@/lib/csv-import";

/**
 * Dry-run an import. Parses the uploaded CSV, matches every row against the
 * current creator table, and returns a per-row preview + summary.
 *
 * This route NEVER writes. It is a pure read: it loads a snapshot of existing
 * creators and runs the same `buildPreview` the confirm route re-runs before it
 * applies anything. The client's preview is advisory only — confirm recomputes.
 */
async function loadExisting(): Promise<ExistingCreatorLite[]> {
  const rows = await db
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
    })
    .from(creators);
  return rows;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const csvText = typeof body.csvText === "string" ? body.csvText : "";
  if (!csvText.trim()) return NextResponse.json({ error: "csvText is required." }, { status: 400 });

  const mapping: Record<string, FieldTarget> | undefined =
    body.mapping && typeof body.mapping === "object" ? body.mapping : undefined;
  const createNew = body.createNew === true;
  const overrides: Record<string, ChangeField[]> =
    body.overrides && typeof body.overrides === "object" ? body.overrides : {};

  const byteLength = Buffer.byteLength(csvText, "utf8");
  const parsed = parseImportFile(csvText, mapping);
  const size = checkSize(byteLength, parsed.rows.length);
  if (!size.ok) return NextResponse.json({ error: size.error }, { status: 413 });

  const existing = await loadExisting();
  const preview = buildPreview(parsed.rows, existing, { createNew, overrides });

  // Sanitized (formula-injection-safe) report of rows needing attention.
  const flagged = preview.rows.filter((r) => r.outcome === "error" || r.outcome === "conflict" || r.outcome === "skipped");
  const reportCsv = flagged.length
    ? toCsv(
        ["row", "handle", "platform", "outcome", "detail", "conflicts"],
        flagged.map((r) => ({
          row: r.index + 1,
          handle: r.handle ?? "",
          platform: r.platform ?? "",
          outcome: r.outcome,
          detail: r.detail,
          conflicts: r.conflicts.join("; "),
        })),
      )
    : null;

  return NextResponse.json({
    ok: true,
    fileHash: fileHash(csvText),
    headers: parsed.headers,
    mapping: parsed.mapping,
    summary: preview.summary,
    rows: preview.rows,
    reportCsv,
  });
}
