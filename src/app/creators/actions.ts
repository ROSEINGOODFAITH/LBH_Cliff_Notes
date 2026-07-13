"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { events } from "@/db/schema";
import { requireTeamMember } from "@/lib/auth";
import {
  insertCreatorIfNew,
  type Platform,
} from "@/lib/creators";
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
    });
    res.created ? created++ : skipped++;
  }
  revalidatePath("/creators");
  return { ok: true, message: `Imported ${created} creator(s); ${skipped} skipped/duplicate.`, created, skipped };
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
