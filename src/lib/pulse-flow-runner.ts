/**
 * Executes SCHEDULED flow runs. A run only reaches `scheduled` after an operator
 * approved it (or retried/rescheduled an already-approved run), so reaching this
 * code means human approval has happened. Even so, every actual external send is
 * additionally gated by the Gmail identity check (`assertSenderAllowed`) so we
 * never mail from the wrong mailbox. Draft-type steps only queue a draft; the
 * single live external-send path is the `send_email` action type.
 *
 * Idempotent: a run is executed only while its status is `scheduled` and its
 * `scheduledFor` is due; a completed run is never re-run.
 */
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { flowRuns } from "@/db/schema";
import { getFlow, updateRun, type FlowRunRow } from "@/lib/pulse-flow-store";
import { ACTION_TYPES, type FlowStep, type FlowRunStatus } from "@/lib/pulse-flow";
import { assertSenderAllowed } from "@/lib/gmail-identity";
import { createOrRegenerateDraft, approveAndSend } from "@/lib/outreach";

export interface RunExecResult {
  ok: boolean;
  runId: string;
  status: FlowRunStatus;
  message: string;
}

async function runStep(run: FlowRunRow, step: FlowStep): Promise<RunExecResult> {
  const meta = ACTION_TYPES[step.actionType];

  if (step.actionType === "send_email") {
    // Real external send — verify sender identity first.
    await assertSenderAllowed();
    const draft = await createOrRegenerateDraft(run.creatorId, null, false);
    if (!draft.ok || !draft.threadId) throw new Error(draft.message);
    const sent = await approveAndSend(draft.threadId);
    if (!sent.ok) throw new Error(sent.message);
    return { ok: true, runId: run.id, status: "completed", message: sent.message };
  }

  if (meta.needsTemplate) {
    // Draft-only: queue a reviewable draft, never send.
    const draft = await createOrRegenerateDraft(run.creatorId, null, step.actionType === "draft" && step.key === "follow-up");
    if (!draft.ok) throw new Error(draft.message);
    await updateRun(run.id, { threadId: draft.threadId ?? null });
    return { ok: true, runId: run.id, status: "completed", message: draft.message };
  }

  // Internal / config-only action (qualify, wait, gift, surface, retain, …).
  return { ok: true, runId: run.id, status: "completed", message: `${meta.label} recorded.` };
}

/** Execute a single scheduled run by id (idempotent). */
export async function executeRun(runId: string): Promise<RunExecResult> {
  const run = (await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1))[0];
  if (!run) return { ok: false, runId, status: "failed", message: "run not found" };
  if (run.status !== "scheduled")
    return { ok: true, runId, status: run.status as FlowRunStatus, message: `skipped — run is ${run.status}` };

  const step = (await getFlow()).find((s) => s.key === run.stepKey);
  if (!step) {
    await updateRun(runId, { status: "failed", lastRunAt: new Date(), lastError: "step no longer exists", attempts: run.attempts + 1 });
    return { ok: false, runId, status: "failed", message: "step no longer exists" };
  }

  try {
    const res = await runStep(run, step);
    await updateRun(runId, { status: res.status, lastRunAt: new Date(), attempts: run.attempts + 1, lastError: null });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "execution failed";
    await updateRun(runId, { status: "failed", lastRunAt: new Date(), attempts: run.attempts + 1, lastError: msg });
    return { ok: false, runId, status: "failed", message: msg };
  }
}

/** Sweep all due scheduled runs (cron entrypoint). */
export async function sweepDueRuns(now: Date = new Date()): Promise<{ processed: number; results: RunExecResult[] }> {
  const due = await db
    .select({ id: flowRuns.id })
    .from(flowRuns)
    .where(and(eq(flowRuns.status, "scheduled"), lte(flowRuns.scheduledFor, now)))
    .limit(50);
  const results: RunExecResult[] = [];
  for (const r of due) results.push(await executeRun(r.id));
  return { processed: results.length, results };
}
