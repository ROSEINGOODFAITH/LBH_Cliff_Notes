import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { creators } from "@/db/schema";

export type Platform = (typeof creators.primaryPlatform.enumValues)[number];
export type CreatorStatus = (typeof creators.status.enumValues)[number];
export type CreatorSource = (typeof creators.source.enumValues)[number];
export type CreatorRow = typeof creators.$inferSelect;
export type NewCreator = typeof creators.$inferInsert;

export interface CreatorFilters {
  q?: string;
  platform?: Platform;
  status?: CreatorStatus;
  source?: CreatorSource;
  niche?: string;
  geo?: string;
  minFollowers?: number;
  maxFollowers?: number;
  minEngagement?: number; // fraction, e.g. 0.02 = 2%
  limit?: number;
  offset?: number;
}

export async function listCreators(f: CreatorFilters = {}): Promise<CreatorRow[]> {
  const conds = [];
  if (f.q) conds.push(or(ilike(creators.handle, `%${f.q}%`), ilike(creators.displayName, `%${f.q}%`)));
  if (f.platform) conds.push(eq(creators.primaryPlatform, f.platform));
  if (f.status) conds.push(eq(creators.status, f.status));
  if (f.source) conds.push(eq(creators.source, f.source));
  if (f.minFollowers != null) conds.push(gte(creators.followerCount, f.minFollowers));
  if (f.maxFollowers != null) conds.push(lte(creators.followerCount, f.maxFollowers));
  if (f.minEngagement != null) conds.push(gte(creators.engagementRate, f.minEngagement));
  if (f.niche)
    conds.push(sql`exists (select 1 from unnest(${creators.nicheTags}) tag where tag ilike ${`%${f.niche}%`})`);
  if (f.geo) conds.push(sql`${creators.audienceGeo}::text ilike ${`%${f.geo}%`}`);

  const where = conds.length ? and(...conds) : undefined;
  return db
    .select()
    .from(creators)
    .where(where)
    .orderBy(sql`${creators.followerCount} desc nulls last`, desc(creators.updatedAt))
    .limit(Math.min(f.limit ?? 100, 200))
    .offset(f.offset ?? 0);
}

export async function getCreator(id: string): Promise<CreatorRow | null> {
  const rows = await db.select().from(creators).where(eq(creators.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Case-insensitive dedup by modashId, else by (handle, platform). */
export async function findExistingCreator(opts: {
  platform?: Platform | null;
  handle: string;
  modashId?: string | null;
}): Promise<CreatorRow | null> {
  if (opts.modashId) {
    const byModash = await db.select().from(creators).where(eq(creators.modashId, opts.modashId)).limit(1);
    if (byModash[0]) return byModash[0];
  }
  const conds = [sql`lower(${creators.handle}) = lower(${opts.handle})`];
  if (opts.platform) conds.push(eq(creators.primaryPlatform, opts.platform));
  const rows = await db
    .select()
    .from(creators)
    .where(and(...conds))
    .limit(1);
  return rows[0] ?? null;
}

/** Insert if new (deduped), otherwise return the existing row. */
export async function insertCreatorIfNew(
  values: NewCreator,
): Promise<{ creator: CreatorRow; created: boolean }> {
  const existing = await findExistingCreator({
    platform: values.primaryPlatform ?? null,
    handle: values.handle,
    modashId: values.modashId ?? null,
  });
  if (existing) return { creator: existing, created: false };
  const [row] = await db.insert(creators).values(values).returning();
  return { creator: row, created: true };
}

export const ENGAGEMENT_REENRICH_DAYS = 30;

/** True if the creator may be re-enriched (never enriched, or older than 30 days). */
export function canReEnrich(c: Pick<CreatorRow, "modashLastEnrichedAt">, force = false): boolean {
  if (force) return true;
  if (!c.modashLastEnrichedAt) return true;
  const ageMs = Date.now() - new Date(c.modashLastEnrichedAt).getTime();
  return ageMs > ENGAGEMENT_REENRICH_DAYS * 24 * 60 * 60 * 1000;
}
