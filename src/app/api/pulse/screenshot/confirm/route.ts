import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { creators, events } from "@/db/schema";
import type { NewCreator } from "@/lib/creators";
import { validateConfirm, defaultStageForUpload, type ExtractPlatform } from "@/lib/screenshot";
import { CREATOR_STAGES, type CreatorStage } from "@/lib/lifecycle";
import { coerceRelationshipTier } from "@/lib/relationship";
import { isReviewNextAction, type ReviewNextAction } from "@/lib/pulse-flow";
import { seedRun, updateRun } from "@/lib/pulse-flow-store";

type Platform = ExtractPlatform;

/** Map an operator's chosen review "next action" onto a flow step to seed. */
const ACTION_TO_STEP: Partial<Record<ReviewNextAction, { key: string; status: "pending" | "approval_needed" }>> = {
  qualify: { key: "qualify", status: "approval_needed" },
  draft_invite: { key: "draft-invite", status: "pending" },
  send_invite: { key: "approve-invite", status: "approval_needed" },
  follow_up: { key: "follow-up", status: "approval_needed" },
};

async function findByEmail(email: string): Promise<typeof creators.$inferSelect | null> {
  const rows = await db.select().from(creators).where(sql`lower(${creators.email}) = ${email}`).limit(1);
  return rows[0] ?? null;
}
async function findByHandle(handle: string, platform: Platform | null): Promise<typeof creators.$inferSelect | null> {
  const conds = [sql`lower(${creators.handle}) = ${handle}`];
  if (platform) conds.push(eq(creators.primaryPlatform, platform));
  const rows = await db.select().from(creators).where(and(...conds)).limit(1);
  return rows[0] ?? null;
}

/**
 * Persist an operator-confirmed screenshot. This is the ONLY place a screenshot
 * turns into a creator, and only after the operator confirmed the identity.
 * Guarantees:
 *  - stage is the operator's explicit choice, defaulting to the earliest prospect
 *    stage (never `replied`, never `contacted`);
 *  - a duplicate (same handle/platform or email) is reported back with the
 *    existing record so the UI can offer update/merge — it is NOT auto-merged and
 *    an existing stage/tier is never overwritten without an explicit flag;
 *  - the chosen next action records an `events` row (and may seed an
 *    approval-gated flow run) — it never sends email and never advances stage.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const v = validateConfirm({ handle: body.handle, platform: body.platform, email: body.email });
  if (!v.ok) return NextResponse.json({ error: v.errors.join(" "), errors: v.errors }, { status: 400 });

  // Operator's explicit stage choice; default earliest prospect stage. Never replied.
  const rawStage = typeof body.stage === "string" ? body.stage : null;
  const stage: CreatorStage = rawStage && (CREATOR_STAGES as string[]).includes(rawStage) ? (rawStage as CreatorStage) : defaultStageForUpload();

  const tier = coerceRelationshipTier(body.relationshipTier);
  const nextAction: ReviewNextAction = isReviewNextAction(body.nextAction) ? body.nextAction : "none";
  const mode = body.mode === "update" ? "update" : body.mode === "create" ? "create" : "auto";

  const displayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim() : null;
  const followerCount = Number.isFinite(body.followerCount) ? Math.round(body.followerCount) : null;
  const bio = typeof body.bio === "string" && body.bio.trim() ? body.bio.trim() : null;

  // Duplicate detection: same handle/platform OR same email.
  const existing = (await findByHandle(v.handle!, v.platform)) ?? (v.email ? await findByEmail(v.email) : null);

  if (existing && mode === "auto") {
    return NextResponse.json({
      duplicate: true,
      existing: {
        id: existing.id,
        handle: existing.handle,
        stage: existing.stage,
        relationshipTier: existing.relationshipTier,
        email: existing.email,
        primaryPlatform: existing.primaryPlatform,
      },
      message: `@${existing.handle} already exists. Choose update (merge new fields) or cancel — nothing was changed.`,
    });
  }

  let creatorId: string;
  let created: boolean;

  if (existing && mode === "update") {
    // Merge: fill only empty contact fields. Never overwrite stage or tier unless
    // the operator explicitly opts in via the *_overwrite flags.
    const patch: Partial<NewCreator> = { updatedAt: new Date() };
    if (!existing.email && v.email) patch.email = v.email;
    if (!existing.displayName && displayName) patch.displayName = displayName;
    if (existing.followerCount == null && followerCount != null) patch.followerCount = followerCount;
    if (!existing.notes && bio) patch.notes = bio;
    if (body.stageOverwrite === true) patch.stage = stage;
    if (body.tierOverwrite === true && tier) patch.relationshipTier = tier;
    await db.update(creators).set(patch).where(eq(creators.id, existing.id));
    creatorId = existing.id;
    created = false;
  } else {
    const values: NewCreator = {
      handle: v.handle!,
      primaryPlatform: v.platform,
      email: v.email,
      displayName,
      followerCount,
      notes: bio,
      source: "manual",
      stage,
      relationshipTier: tier,
    };
    const [row] = await db.insert(creators).values(values).returning({ id: creators.id });
    creatorId = row.id;
    created = true;
  }

  await db.insert(events).values({
    creatorId,
    type: "screenshot.confirmed",
    payload: { created, stage, relationshipTier: tier, nextAction, source: "screenshot" },
  });

  // Seed an approval-gated flow run for a queuing action. Never sends.
  const step = ACTION_TO_STEP[nextAction];
  if (step) {
    const run = await seedRun(creatorId, step.key);
    // Only shape a freshly-seeded run; never clobber existing progress.
    if (run.status === "pending" && step.status !== "pending") await updateRun(run.id, { status: step.status });
    await db.insert(events).values({ creatorId, type: "flow.run.seeded", payload: { stepKey: step.key, status: step.status } });
  }

  return NextResponse.json({ ok: true, creatorId, created, stage, relationshipTier: tier, nextAction });
}
