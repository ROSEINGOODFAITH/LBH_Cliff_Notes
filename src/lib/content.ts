import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creators, contentMentions, events } from "@/db/schema";
import { brandConfig } from "@/lib/brand";
import { getCollaborationPosts, modashConfigured, type ModashPlatform } from "@/lib/modash";
import { ENGAGED_STAGES } from "@/lib/lifecycle";

export type ContentRow = typeof contentMentions.$inferSelect;

function matchesBrand(sponsors: Array<{ name?: string; domain?: string }> | undefined): boolean {
  const name = brandConfig.brandName.toLowerCase();
  const domainKey = brandConfig.brandDomain.toLowerCase().replace(/\.[a-z]+$/, ""); // "laurelbathhouse"
  return (sponsors ?? []).some((s) => {
    const d = (s?.domain ?? "").toLowerCase();
    const n = (s?.name ?? "").toLowerCase();
    return (d && d.includes(domainKey)) || (n && n.includes(name));
  });
}

export interface MentionSyncResult {
  ok: boolean;
  message: string;
  found: number;
  added: number;
}

/** Poll Modash collaborations for active creators, store posts that mention our brand. */
export async function syncBrandMentions(): Promise<MentionSyncResult> {
  if (!modashConfigured()) return { ok: false, message: "Modash isn't configured — add MODASH_API_KEY.", found: 0, added: 0 };

  const tracked = await db
    .select()
    .from(creators)
    .where(inArray(creators.stage, ENGAGED_STAGES))
    .limit(25);
  if (tracked.length === 0) return { ok: true, message: "No active creators to track yet.", found: 0, added: 0 };

  let found = 0;
  let added = 0;
  for (const c of tracked) {
    const platform = (c.primaryPlatform ?? "instagram") as ModashPlatform;
    let json: Record<string, unknown>;
    try {
      json = await getCollaborationPosts({ id: c.modashId ?? c.handle, platform, limit: 20 });
    } catch {
      continue;
    }
    const influencer = (json?.influencer ?? {}) as { posts?: Array<Record<string, unknown>> };
    const posts = influencer.posts ?? [];
    for (const post of posts) {
      const sponsors = post?.sponsors as Array<{ name?: string; domain?: string }> | undefined;
      if (!matchesBrand(sponsors)) continue;
      found++;
      const postUrl = `modash:${platform}:${post?.post_id}`;
      const dup = await db.select({ id: contentMentions.id }).from(contentMentions).where(eq(contentMentions.postUrl, postUrl)).limit(1);
      if (dup[0]) continue;
      const ts = post?.post_timestamp;
      await db
        .insert(contentMentions)
        .values({
          creatorId: c.id,
          platform,
          postUrl,
          postedAt: ts ? new Date(Number(ts)) : null,
          caption: (post?.title as string) ?? (post?.description as string) ?? null,
          mediaUrl: (post?.post_thumbnail as string) ?? null,
          metricsJson: post?.stats ?? null,
        })
        .onConflictDoNothing({ target: contentMentions.postUrl });
      await db.insert(events).values({ creatorId: c.id, type: "content.mention", payload: { postUrl } });
      added++;
    }
  }
  return { ok: true, message: `Scanned ${tracked.length} creator(s): ${found} brand mention(s), ${added} new.`, found, added };
}

export interface ContentFilters {
  q?: string;
  platform?: ModashPlatform;
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
