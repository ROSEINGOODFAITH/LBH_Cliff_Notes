"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creators, events } from "@/db/schema";
import { requireTeamMember } from "@/lib/auth";
import {
  insertCreatorIfNew,
  getCreator,
  canReEnrich,
  type Platform,
} from "@/lib/creators";
import {
  getProfileReport,
  extractEnrichment,
  modashConfigured,
  ModashNotConfiguredError,
  type ModashPlatform,
} from "@/lib/modash";
import { parseCsv } from "@/lib/csv";
import { shopifyRest } from "@/lib/shopify";

export interface ActionResult {
  ok: boolean;
  message: string;
  created?: number;
  skipped?: number;
}

const PLATFORMS = ["instagram", "tiktok", "youtube"] as const;

function str(fd: FormData, k: string): string | undefined {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function num(fd: FormData, k: string): number | undefined {
  const v = str(fd, k);
  if (v == null) return undefined;
  const n = Number(v.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
function asPlatform(v: string | undefined): Platform | null {
  return v && (PLATFORMS as readonly string[]).includes(v) ? (v as Platform) : null;
}

export async function addCreatorManual(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireTeamMember();
  const handle = str(fd, "handle")?.replace(/^@/, "");
  if (!handle) return { ok: false, message: "Handle is required." };
  const niche = str(fd, "niche");
  const { creator, created } = await insertCreatorIfNew({
    handle,
    displayName: str(fd, "displayName") ?? null,
    email: str(fd, "email") ?? null,
    primaryPlatform: asPlatform(str(fd, "platform")),
    followerCount: num(fd, "followerCount") ?? null,
    nicheTags: niche ? niche.split(",").map((s) => s.trim()).filter(Boolean) : null,
    source: "manual",
    status: "prospect",
  });
  await db.insert(events).values({
    creatorId: creator.id,
    type: created ? "creator.added.manual" : "creator.add.duplicate",
    payload: { handle },
  });
  revalidatePath("/creators");
  return {
    ok: true,
    message: created ? `Added @${handle}.` : `@${handle} already exists — not duplicated.`,
    created: created ? 1 : 0,
    skipped: created ? 0 : 1,
  };
}

export async function importCreatorsCsv(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireTeamMember();
  const csv = str(fd, "csv");
  if (!csv) return { ok: false, message: "Paste CSV content (with a header row)." };
  const rows = parseCsv(csv);
  if (rows.length === 0) return { ok: false, message: "No data rows found." };
  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const handle = (r.handle || r.username || "").replace(/^@/, "").trim();
    if (!handle) {
      skipped++;
      continue;
    }
    const niche = (r.niche || r.niches || "").trim();
    const followers = Number((r.followers || r.followerCount || "").replace(/[, ]/g, ""));
    const res = await insertCreatorIfNew({
      handle,
      displayName: (r.displayName || r.name || "").trim() || null,
      email: (r.email || "").trim() || null,
      primaryPlatform: asPlatform((r.platform || "").trim().toLowerCase()),
      followerCount: Number.isFinite(followers) && followers > 0 ? followers : null,
      nicheTags: niche ? niche.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : null,
      source: "manual",
      status: "prospect",
    });
    res.created ? created++ : skipped++;
  }
  revalidatePath("/creators");
  return { ok: true, message: `Imported ${created} creator(s); ${skipped} skipped/duplicate.`, created, skipped };
}

export async function enrichCreator(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireTeamMember();
  const id = str(fd, "creatorId");
  if (!id) return { ok: false, message: "Missing creator." };
  const force = str(fd, "force") === "1";
  const creator = await getCreator(id);
  if (!creator) return { ok: false, message: "Creator not found." };
  if (!modashConfigured())
    return { ok: false, message: "Modash isn't configured yet — add MODASH_API_KEY to enrich." };
  if (!canReEnrich(creator, force))
    return { ok: false, message: "Enriched within the last 30 days. Re-enrich with force to override." };

  const platform = (creator.primaryPlatform ?? "instagram") as ModashPlatform;
  const lookupId = creator.modashId ?? creator.handle;
  try {
    const report = await getProfileReport(platform, lookupId);
    const e = extractEnrichment(report as Record<string, unknown>);
    await db
      .update(creators)
      .set({
        displayName: e.displayName ?? creator.displayName,
        email: e.email ?? creator.email,
        followerCount: e.followerCount ?? creator.followerCount,
        engagementRate: e.engagementRate ?? creator.engagementRate,
        avatarUrl: e.avatarUrl ?? creator.avatarUrl,
        nicheTags: e.nicheTags ?? creator.nicheTags,
        audienceGeo: e.audienceGeo ?? creator.audienceGeo,
        audienceAge: e.audienceAge ?? creator.audienceAge,
        modashId: e.modashId ?? creator.modashId,
        modashLastEnrichedAt: new Date(),
      })
      .where(eq(creators.id, id));
    await db.insert(events).values({ creatorId: id, type: "creator.enriched", payload: { platform } });
    revalidatePath("/creators");
    return { ok: true, message: `Enriched @${creator.handle}.` };
  } catch (err) {
    if (err instanceof ModashNotConfiguredError) return { ok: false, message: err.message };
    return { ok: false, message: err instanceof Error ? err.message : "Enrichment failed." };
  }
}

export async function seedFromShopify(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireTeamMember();
  const tag = str(fd, "tag") ?? "creator";
  try {
    const data = await shopifyRest<{ customers: Array<Record<string, unknown>> }>(
      `/customers/search.json?query=${encodeURIComponent(`tag:${tag}`)}&limit=50`,
    );
    let created = 0;
    let skipped = 0;
    for (const c of data.customers ?? []) {
      const email = (c.email as string) || null;
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
      const handle = email ?? (name ? name.replace(/\s+/g, "").toLowerCase() : String(c.id));
      const res = await insertCreatorIfNew({
        handle,
        displayName: name,
        email,
        source: "first_party",
        status: "prospect",
        notes: `Imported from Shopify (tag: ${tag})`,
      });
      if (res.created) {
        created++;
        await db.insert(events).values({
          creatorId: res.creator.id,
          type: "creator.seed.shopify",
          payload: { tag, shopifyCustomerId: c.id },
        });
      } else skipped++;
    }
    revalidatePath("/creators");
    return {
      ok: true,
      message: `Imported ${created} first-party creator(s) from Shopify (tag: ${tag}); ${skipped} already existed.`,
      created,
      skipped,
    };
  } catch (err) {
    return { ok: false, message: `Shopify import failed: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}
