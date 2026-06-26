"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { creators, discoveryCandidates, events } from "@/db/schema";
import { requireTeamMember } from "@/lib/auth";
import { brandConfig } from "@/lib/brand";
import { insertCreatorIfNew } from "@/lib/creators";
import {
  getCollaborationPosts,
  extractCandidatesFromCollaborations,
  modashConfigured,
  ModashNotConfiguredError,
  type ModashPlatform,
} from "@/lib/modash";

export interface DiscoveryResult {
  ok: boolean;
  message: string;
  found?: number;
  added?: number;
}

const PLATFORMS = ["instagram", "tiktok", "youtube"] as const;

export async function runCompetitorDiscovery(
  _prev: DiscoveryResult | null,
  fd: FormData,
): Promise<DiscoveryResult> {
  await requireTeamMember();
  if (!modashConfigured())
    return { ok: false, message: "Modash isn't configured yet — add MODASH_API_KEY to run discovery." };

  const platformRaw = (fd.get("platform") as string) || "instagram";
  const platform = ((PLATFORMS as readonly string[]).includes(platformRaw) ? platformRaw : "instagram") as ModashPlatform;
  const raw = ((fd.get("competitors") as string) || "").trim();
  const competitors = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : [...brandConfig.competitorBrands];
  if (competitors.length === 0) return { ok: false, message: "No competitor brands configured." };

  let found = 0;
  let added = 0;
  for (const brand of competitors) {
    let json: Record<string, unknown>;
    try {
      json = await getCollaborationPosts({ id: brand.replace(/^@/, ""), platform, limit: 50 });
    } catch (err) {
      if (err instanceof ModashNotConfiguredError) return { ok: false, message: err.message };
      continue; // skip a single brand failure, keep scanning the rest
    }
    const candidates = extractCandidatesFromCollaborations(json, platform);
    for (const cand of candidates) {
      found++;
      // dedupe vs existing creators
      const existingCreator = await db
        .select({ id: creators.id })
        .from(creators)
        .where(
          cand.modashUserId
            ? eq(creators.modashId, cand.modashUserId)
            : sql`lower(${creators.handle}) = lower(${cand.handle})`,
        )
        .limit(1);
      if (existingCreator[0]) continue;
      // dedupe vs existing candidates
      const existingCand = await db
        .select({ id: discoveryCandidates.id })
        .from(discoveryCandidates)
        .where(
          and(
            eq(discoveryCandidates.platform, cand.platform),
            sql`lower(${discoveryCandidates.handle}) = lower(${cand.handle})`,
          ),
        )
        .limit(1);
      if (existingCand[0]) continue;

      await db.insert(discoveryCandidates).values({
        platform: cand.platform,
        modashUserId: cand.modashUserId,
        handle: cand.handle,
        url: cand.url,
        collaborationType: cand.collaborationType,
        sourceCompetitor: brand,
        raw: cand.raw,
        status: "new",
      });
      added++;
    }
  }
  await db.insert(events).values({ type: "discovery.run", payload: { platform, competitors, found, added } });
  revalidatePath("/discovery");
  return {
    ok: true,
    message: `Scanned ${competitors.length} competitor(s): ${found} collaboration post(s), ${added} new candidate(s).`,
    found,
    added,
  };
}

export async function approveCandidate(_prev: DiscoveryResult | null, fd: FormData): Promise<DiscoveryResult> {
  await requireTeamMember();
  const id = fd.get("candidateId") as string;
  if (!id) return { ok: false, message: "Missing candidate." };
  const rows = await db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, id)).limit(1);
  const cand = rows[0];
  if (!cand) return { ok: false, message: "Candidate not found." };

  const { creator, created } = await insertCreatorIfNew({
    handle: cand.handle,
    displayName: cand.displayName,
    primaryPlatform: cand.platform,
    followerCount: cand.followers,
    engagementRate: cand.engagementRate,
    avatarUrl: cand.avatarUrl,
    modashId: cand.modashUserId,
    source: "competitor_mention",
    status: "prospect",
    notes: cand.sourceCompetitor ? `Discovered via collaboration with ${cand.sourceCompetitor}` : null,
  });
  await db
    .update(discoveryCandidates)
    .set({ status: "approved", creatorId: creator.id })
    .where(eq(discoveryCandidates.id, id));
  await db.insert(events).values({ creatorId: creator.id, type: "discovery.approved", payload: { candidateId: id, created } });
  revalidatePath("/discovery");
  revalidatePath("/creators");
  return {
    ok: true,
    message: created ? `Saved @${cand.handle} to creators.` : `@${cand.handle} already in creators — marked approved.`,
  };
}

export async function dismissCandidate(fd: FormData): Promise<void> {
  await requireTeamMember();
  const id = fd.get("candidateId") as string;
  if (!id) return;
  await db.update(discoveryCandidates).set({ status: "dismissed" }).where(eq(discoveryCandidates.id, id));
  revalidatePath("/discovery");
}
