import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creators } from "@/db/schema";
import { inngest } from "@/lib/inngest";

/**
 * Manual PULSE intake — accepts either `handles: string[]` or `rows` parsed
 * from a Modash CSV export (handle + optional stats). Modash's public API does
 * not expose in-app Lists, so curated lists are pasted or CSV-exported from
 * the app; CSV rows arrive with real stats and need no Modash API credits.
 * Each new handle is inserted as stage `sourced` and emits `creator.sourced`
 * (enrich → review). Re-importing a handle still in `sourced` re-queues it
 * (self-serve retry) and refreshes any provided stats. Clerk-protected.
 */
const HANDLE_RE = /^[a-z0-9._]{2,24}$/;
const normalize = (h: string) =>
  h.trim()
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "")
    .replace(/[?#/].*$/, "")
    .replace(/^@+/, "")
    .toLowerCase();
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rawRows: any[] = Array.isArray(body?.rows)
    ? body.rows
    : Array.isArray(body?.handles)
      ? body.handles.map((h: unknown) => ({ handle: String(h) }))
      : [];
  if (!rawRows.length)
    return NextResponse.json({ error: "rows or handles required" }, { status: 400 });

  const seen = new Set<string>();
  const rows: { handle: string; stats: Record<string, any> }[] = [];
  let invalid = 0;
  for (const r of rawRows) {
    const handle = normalize(String(r?.handle ?? ""));
    if (!HANDLE_RE.test(handle)) { invalid++; continue; }
    if (seen.has(handle)) continue;
    seen.add(handle);
    let er = num(r?.engagementRate);
    if (er != null && er > 1) er = er / 100; // tolerate percent input; store 0..1 fraction
    const stats: Record<string, any> = {};
    if (num(r?.followerCount) != null) stats.followerCount = Math.round(num(r?.followerCount)!);
    if (er != null) stats.engagementRate = er;
    if (num(r?.avgViews) != null) stats.avgViews = Math.round(num(r?.avgViews)!);
    if (num(r?.fakeFollowerPct) != null) stats.fakeFollowerPct = num(r?.fakeFollowerPct);
    if (str(r?.geo)) stats.geo = str(r?.geo);
    if (str(r?.niche)) stats.niche = str(r?.niche)!.toLowerCase();
    if (str(r?.email)) stats.email = str(r?.email)!.toLowerCase();
    rows.push({ handle, stats });
    if (rows.length >= 500) break;
  }

  let queued = 0, requeued = 0, duplicates = 0;
  for (const { handle, stats } of rows) {
    const row = await db.insert(creators).values({
      modashId: handle, // Modash report lookups accept handle or userId; unique index = dedupe key
      handle,
      source: "modash",
      primaryPlatform: "tiktok",
      ...stats,
      rawModash: { manualIntake: true, importedAt: new Date().toISOString() },
    }).onConflictDoNothing({ target: creators.modashId }).returning({ id: creators.id });
    if (row.length) {
      queued++;
      await inngest.send({ name: "creator.sourced", data: { creatorId: row[0].id } });
    } else {
      // Already known. If it's still waiting on enrichment (e.g. an earlier
      // import hit Modash rate limits), refresh stats + re-emit — re-pasting
      // the same list is the self-serve retry.
      const existing = (await db.select({ id: creators.id, stage: creators.stage })
        .from(creators).where(eq(creators.modashId, handle)))[0];
      if (existing?.stage === "sourced") {
        if (Object.keys(stats).length)
          await db.update(creators).set({ ...stats, updatedAt: new Date() }).where(eq(creators.id, existing.id));
        requeued++;
        await inngest.send({ name: "creator.sourced", data: { creatorId: existing.id } });
      } else duplicates++;
    }
  }
  return NextResponse.json({ ok: true, received: rawRows.length, queued, requeued, duplicates, invalid });
}
