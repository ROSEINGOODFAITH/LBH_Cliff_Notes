"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { discoveryCandidates, events } from "@/db/schema";
import { requireTeamMember } from "@/lib/auth";
import { insertCreatorIfNew } from "@/lib/creators";

export interface DiscoveryResult {
  ok: boolean;
  message: string;
  found?: number;
  added?: number;
}

export async function runCompetitorDiscovery(
  _prev: DiscoveryResult | null,
  _fd: FormData,
): Promise<DiscoveryResult> {
  await requireTeamMember();
  return { ok: false, message: "No external discovery source is configured." };
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
    externalId: cand.externalUserId,
    source: "competitor_mention",
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
