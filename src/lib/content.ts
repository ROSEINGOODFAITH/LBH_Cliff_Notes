import { and, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { creators, contentMentions } from "@/db/schema";

export type Platform = "instagram" | "tiktok" | "youtube";

export type ContentRow = typeof contentMentions.$inferSelect;

export interface MentionSyncResult {
  ok: boolean;
  message: string;
  found: number;
  added: number;
}

/** Sync brand mentions from an external content source (none configured yet). */
export async function syncBrandMentions(): Promise<MentionSyncResult> {
  return { ok: false, message: "No external content source configured.", found: 0, added: 0 };
}

export interface ContentFilters {
  q?: string;
  platform?: Platform;
}
export interface ContentItem {
  mention: ContentRow;
  handle: string;
}

export async function listContentMentions(f: ContentFilters = {}): Promise<ContentItem[]> {
  const conds = [];
  if (f.platform) conds.push(eq(contentMentions.platform, f.platform));
  if (f.q) conds.push(ilike(creators.handle, `%${f.q}%`));
  const rows = await db
    .select({ mention: contentMentions, handle: creators.handle })
    .from(contentMentions)
    .innerJoin(creators, eq(contentMentions.creatorId, creators.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(contentMentions.postedAt))
    .limit(200);
  return rows.map((r) => ({ mention: r.mention, handle: r.handle }));
}
