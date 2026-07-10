import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creators } from "@/db/schema";
import { inngest } from "@/lib/inngest";

/**
 * Manual PULSE intake, two modes:
 *
 * 1. `prospects` (default) — TikTok or Instagram handles, or a Modash CSV
 *    export (stats + emails ride along, no Modash API credits needed).
 *    Inserted as stage `sourced`, emits `creator.sourced` → enrich → review.
 *    Re-importing a handle still in `sourced` re-queues it and refreshes stats.
 *
 * 2. `contacts` — people the owner is ALREADY emailing (name + email,
 *    optional handle/tier). Inserted directly at stage `replied` so they skip
 *    cold outreach entirely; the owner sends them the Tally link himself and
 *    the Tally webhook matches them by handle OR email (owner-approved,
 *    spec §12). Deduped by email.
 *
 * Clerk-protected (not in the public middleware matcher).
 */
const HANDLE_RE = /^[a-z0-9._]{2,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalize = (h: string) =>
  h.trim()
    .replace(/^https?:\/\/(www\.)?(tiktok\.com\/@?|instagram\.com\/)/i, "")
    .replace(/[?#/].*$/, "")
    .replace(/^@+/, "")
    .toLowerCase();
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const mode = body?.mode === "contacts" ? "contacts" : "prospects";
  const rawRows: any[] = Array.isArray(body?.rows)
    ? body.rows
    : Array.isArray(body?.handles)
      ? body.handles.map((h: unknown) => ({ handle: String(h) }))
      : [];
  if (!rawRows.length)
    return NextResponse.json({ error: "rows or handles required" }, { status: 400 });

  /* ---------------- contacts: already-in-conversation people ---------------- */
  if (mode === "contacts") {
    let queued = 0, duplicates = 0, invalid = 0;
    for (const r of rawRows.slice(0, 500)) {
      const email = str(r?.email)?.toLowerCase() ?? null;
      if (!email || !EMAIL_RE.test(email)) { invalid++; continue; }
      const existing = (await db.select({ id: creators.id }).from(creators)
        .where(eq(creators.email, email)))[0];
      if (existing) { duplicates++; continue; }
      const handleRaw = normalize(String(r?.handle ?? ""));
      const handle = HANDLE_RE.test(handleRaw) ? handleRaw : email.split("@")[0];
      const platform = r?.platform === "instagram" ? ("instagram" as const) : ("tiktok" as const);
      await db.insert(creators).values({
        handle,
        displayName: str(r?.name),
        email,
        source: "manual",
        primaryPlatform: platform,
        ...(platform === "instagram" && HANDLE_RE.test(handleRaw) ? { igHandle: handleRaw } : {}),
        stage: "replied", // already talking — skips cold outreach; Tally matches by handle OR email
        tier: r?.tier === "A" ? "A" : "B",
        rawModash: { manualContact: true, importedAt: new Date().toISOString() },
      });
      queued++;
    }
    return NextResponse.json({ ok: true, mode, received: rawRows.length, queued, duplicates, invalid });
  }

  /* ------------------------- prospects: review queue ------------------------ */
  const seen = new Set<string>();
  const rows: { handle: string; platform: "tiktok" | "instagram"; stats: Record<string, any>; extraEmails: string[] | null }[] = [];
  let invalid = 0;
  for (const r of rawRows) {
    const handle = normalize(String(r?.handle ?? ""));
    if (!HANDLE_RE.test(handle)) { invalid++; continue; }
    if (seen.has(handle)) continue;
    seen.add(handle);
    const platform = r?.platform === "instagram" ? ("instagram" as const) : ("tiktok" as const);
    let er = num(r?.engagementRate);
    if (er != null && er > 1) er = er / 100; // tolerate percent input; store 0..1 fraction
    const stats: Record<string, any> = {};
    if (num(r?.followerCount) != null) stats.followerCount = Math.round(num(r?.followerCount)!);
    if (er != null) stats.engagementRate = er;
    if (num(r?.avgViews) != null) stats.avgViews = Math.round(num(r?.avgViews)!);
    if (num(r?.fakeFollowerPct) != null) stats.fakeFollowerPct = num(r?.fakeFollowerPct);
    if (str(r?.geo)) stats.geo = str(r?.geo);
    if (str(r?.niche)) stats.niche = str(r?.niche)!.toLowerCase();
    // Emails: validate, lowercase, dedupe; first becomes the contact address,
    // the rest are kept on the creator's file (rawModash.emails).
    const emailCandidates: unknown[] = Array.isArray(r?.emails) ? r.emails : [r?.email];
    const emails: string[] = [...new Set(
      emailCandidates
        .map((e) => String(e ?? "").trim().toLowerCase())
        .filter((e) => EMAIL_RE.test(e)),
    )].slice(0, 5);
    if (emails.length) stats.email = emails[0];
    rows.push({ handle, platform, stats, extraEmails: emails.length > 1 ? emails : null });
    if (rows.length >= 500) break;
  }

  let queued = 0, requeued = 0, duplicates = 0;
  for (const { handle, platform, stats, extraEmails } of rows) {
    // Dedupe key: TikTok keeps the bare handle (back-compat with existing rows);
    // Instagram is prefixed so the same handle string on both platforms can't collide.
    const dedupeKey = platform === "instagram" ? `ig:${handle}` : handle;
    const row = await db.insert(creators).values({
      modashId: dedupeKey,
      handle,
      source: "modash",
      primaryPlatform: platform,
      ...(platform === "instagram" ? { igHandle: handle } : {}),
      ...stats,
      rawModash: { manualIntake: true, importedAt: new Date().toISOString(), ...(extraEmails ? { emails: extraEmails } : {}) },
    }).onConflictDoNothing({ target: creators.modashId }).returning({ id: creators.id });
    if (row.length) {
      queued++;
      await inngest.send({ name: "creator.sourced", data: { creatorId: row[0].id } });
    } else {
      // Already known — if still waiting on enrichment, refresh stats + re-emit
      // (re-pasting the same list is the self-serve retry).
      const existing = (await db.select({ id: creators.id, stage: creators.stage })
        .from(creators).where(eq(creators.modashId, dedupeKey)))[0];
      if (existing?.stage === "sourced") {
        if (Object.keys(stats).length)
          await db.update(creators).set({ ...stats, updatedAt: new Date() }).where(eq(creators.id, existing.id));
        requeued++;
        await inngest.send({ name: "creator.sourced", data: { creatorId: existing.id } });
      } else duplicates++;
    }
  }
  return NextResponse.json({ ok: true, mode, received: rawRows.length, queued, requeued, duplicates, invalid });
}
