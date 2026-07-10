import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { creators } from "@/db/schema";
import { inngest } from "@/lib/inngest";

/**
 * Manual PULSE intake — paste TikTok handles (e.g. from a curated Modash list;
 * Modash's public API does not expose in-app Lists, so handles are pasted or
 * CSV-exported from the app). Each new handle is inserted as stage `sourced`
 * and emits `creator.sourced`, flowing through the normal enrich → review
 * pipeline. Clerk-protected (not in the public middleware matcher).
 */
const HANDLE_RE = /^[a-z0-9._]{2,24}$/;
const normalize = (h: string) =>
  h.trim()
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "")
    .replace(/[?#/].*$/, "")
    .replace(/^@+/, "")
    .toLowerCase();

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const handles: unknown = body?.handles;
  if (!Array.isArray(handles) || handles.length === 0)
    return NextResponse.json({ error: "handles: string[] required" }, { status: 400 });

  const normalized = handles.map((h) => normalize(String(h)));
  const invalid = normalized.filter((h) => !HANDLE_RE.test(h)).length;
  const clean = [...new Set(normalized.filter((h) => HANDLE_RE.test(h)))].slice(0, 500);

  let queued = 0, duplicates = 0;
  for (const handle of clean) {
    const row = await db.insert(creators).values({
      modashId: handle, // Modash report lookups accept handle or userId; unique index = dedupe key
      handle,
      source: "modash",
      primaryPlatform: "tiktok",
      rawModash: { manualIntake: true, importedAt: new Date().toISOString() },
    }).onConflictDoNothing({ target: creators.modashId }).returning({ id: creators.id });
    if (row.length) {
      queued++;
      await inngest.send({ name: "creator.sourced", data: { creatorId: row[0].id } });
    } else duplicates++;
  }
  return NextResponse.json({ ok: true, received: handles.length, queued, duplicates, invalid });
}
