/**
 * Persistence for the PULSE action flow (config) and per-creator runs (progress).
 *
 * The flow CONFIG is a single ordered list of steps (lib/pulse-flow.ts). We store
 * it in `flow_steps`, seeding the editable default on first read so the builder
 * always has something coherent to show. Saving validates first (never persists a
 * broken flow) and rewrites the whole ordered set transactionally-ish.
 *
 * A RUN is one creator's progress at one step (`flow_runs`), with an idempotency
 * key of (creatorId, stepKey): seeding or scheduling the same step twice is a
 * no-op. Nothing here sends email or advances the canonical stage.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { flowRuns, flowSteps } from "@/db/schema";
import type { CreatorStage } from "@/lib/lifecycle";
import type { TemplateKey } from "@/lib/pulse-templates";
import { TEMPLATE_KEYS } from "@/lib/pulse-templates";
import { coerceRelationshipTier, type RelationshipTier } from "@/lib/relationship";
import {
  cloneDefaultFlow,
  relink,
  validateFlow,
  flowHasErrors,
  FLOW_ACTION_TYPES,
  type FlowActionType,
  type FlowStep,
  type FlowRunStatus,
} from "@/lib/pulse-flow";
import { CREATOR_STAGES } from "@/lib/lifecycle";

type FlowStepRow = typeof flowSteps.$inferSelect;
export type FlowRunRow = typeof flowRuns.$inferSelect;

const ACTION_SET = new Set<string>(FLOW_ACTION_TYPES);
const STAGE_SET = new Set<string>(CREATOR_STAGES);
const TEMPLATE_SET = new Set<string>(TEMPLATE_KEYS);

/** Coerce a persisted row back into a typed FlowStep (defensive against drift). */
function rowToStep(r: FlowStepRow): FlowStep {
  const tiers = (r.tiers ?? [])
    .map((t) => coerceRelationshipTier(t))
    .filter((t): t is RelationshipTier => t != null);
  return {
    key: r.key,
    name: r.name,
    actionType: (ACTION_SET.has(r.actionType) ? r.actionType : "qualify") as FlowActionType,
    stage: r.stage && STAGE_SET.has(r.stage) ? (r.stage as CreatorStage) : null,
    tiers,
    templateKey: r.templateKey && TEMPLATE_SET.has(r.templateKey) ? (r.templateKey as TemplateKey) : null,
    delayMinutes: r.delayMinutes ?? null,
    approvalRequired: r.approvalRequired,
    autoSendsExternal: r.autoSendsExternal,
    enabled: r.enabled,
    nextStepKey: r.nextStepKey ?? null,
  };
}

/** Read the active flow, seeding the editable default the first time. */
export async function getFlow(): Promise<FlowStep[]> {
  const rows = await db.select().from(flowSteps).orderBy(asc(flowSteps.position));
  if (rows.length === 0) {
    const seeded = relink(cloneDefaultFlow());
    await saveFlowRows(seeded);
    return seeded;
  }
  return relink(rows.map(rowToStep));
}

async function saveFlowRows(steps: FlowStep[]): Promise<void> {
  await db.delete(flowSteps);
  if (steps.length === 0) return;
  await db.insert(flowSteps).values(
    steps.map((s, i) => ({
      key: s.key,
      name: s.name,
      actionType: s.actionType,
      stage: s.stage,
      tiers: s.tiers,
      templateKey: s.templateKey,
      delayMinutes: s.delayMinutes,
      approvalRequired: s.approvalRequired,
      autoSendsExternal: s.autoSendsExternal,
      enabled: s.enabled,
      nextStepKey: s.nextStepKey,
      position: i,
    })),
  );
}

export interface SaveFlowResult {
  ok: boolean;
  steps: FlowStep[];
  issues: ReturnType<typeof validateFlow>;
}

/** Validate then persist. A flow with errors is rejected (returns issues, no write). */
export async function saveFlow(input: FlowStep[]): Promise<SaveFlowResult> {
  const steps = relink(input);
  const issues = validateFlow(steps);
  if (flowHasErrors(steps)) return { ok: false, steps, issues };
  await saveFlowRows(steps);
  return { ok: true, steps, issues };
}

/* ------------------------------- runs ------------------------------------- */

/**
 * Idempotently seed a run for (creator, step) at `pending`. Returns the existing
 * row if one already exists — never duplicates and never overwrites progress.
 */
export async function seedRun(creatorId: string, stepKey: string): Promise<FlowRunRow> {
  const existing = await db
    .select()
    .from(flowRuns)
    .where(and(eq(flowRuns.creatorId, creatorId), eq(flowRuns.stepKey, stepKey)))
    .limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db
    .insert(flowRuns)
    .values({ creatorId, stepKey, status: "pending" })
    .onConflictDoNothing({ target: [flowRuns.creatorId, flowRuns.stepKey] })
    .returning();
  if (row) return row;
  const again = await db
    .select()
    .from(flowRuns)
    .where(and(eq(flowRuns.creatorId, creatorId), eq(flowRuns.stepKey, stepKey)))
    .limit(1);
  return again[0];
}

export async function listRunsForCreator(creatorId: string): Promise<FlowRunRow[]> {
  return db.select().from(flowRuns).where(eq(flowRuns.creatorId, creatorId));
}

export async function getRun(id: string): Promise<FlowRunRow | null> {
  const rows = await db.select().from(flowRuns).where(eq(flowRuns.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateRun(
  id: string,
  patch: Partial<{
    status: FlowRunStatus;
    scheduledFor: Date | null;
    lastRunAt: Date | null;
    lastError: string | null;
    threadId: string | null;
    attempts: number;
  }>,
): Promise<FlowRunRow | null> {
  const [row] = await db.update(flowRuns).set(patch).where(eq(flowRuns.id, id)).returning();
  return row ?? null;
}
