import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getFlow, getRun, listRunsForCreator, updateRun } from "@/lib/pulse-flow-store";
import { runActionTarget, type RunOperatorAction } from "@/lib/pulse-flow";
import { inngest } from "@/lib/inngest";
import { integrations } from "@/lib/env";

const ACTIONS: RunOperatorAction[] = ["approve", "skip", "retry", "reschedule", "cancel"];

/** Per-creator progress: every seeded run joined against its flow step. */
export async function GET(req: NextRequest) {
  const creatorId = req.nextUrl.searchParams.get("creatorId");
  if (!creatorId) return NextResponse.json({ error: "creatorId required" }, { status: 400 });
  const [runs, steps] = await Promise.all([listRunsForCreator(creatorId), getFlow()]);
  const byKey = new Map(steps.map((s) => [s.key, s]));
  return NextResponse.json({
    runs: runs.map((r) => ({ ...r, step: byKey.get(r.stepKey) ?? null })),
  });
}

/**
 * Apply an operator action to a run. Purely a state transition + (for scheduled
 * work) an idempotent Inngest enqueue. It NEVER sends email inline — `approve`
 * moves an approval-gated run to `scheduled`; the scheduler performs the actual
 * approval-gated draft/send. Cancel/skip/retry/reschedule are recorded too.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const runId = typeof body.runId === "string" ? body.runId : "";
  const action = body.action as RunOperatorAction;
  if (!runId || !ACTIONS.includes(action))
    return NextResponse.json({ error: `runId and action (${ACTIONS.join("|")}) required` }, { status: 400 });

  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const target = runActionTarget(action, run.status as never);
  if (!target)
    return NextResponse.json({ error: `Cannot ${action} a run that is ${run.status}.` }, { status: 409 });

  let scheduledFor: Date | null = run.scheduledFor;
  if (target === "scheduled") {
    if (typeof body.scheduledFor === "string" && !Number.isNaN(Date.parse(body.scheduledFor))) {
      scheduledFor = new Date(body.scheduledFor);
    } else {
      const step = (await getFlow()).find((s) => s.key === run.stepKey);
      const delayMs = (step?.delayMinutes ?? 0) * 60_000;
      scheduledFor = new Date(Date.now() + delayMs);
    }
  }

  const updated = await updateRun(runId, {
    status: target,
    scheduledFor: target === "scheduled" ? scheduledFor : run.scheduledFor,
    lastError: action === "retry" ? null : run.lastError,
  });

  await db.insert(events).values({
    creatorId: run.creatorId,
    type: "flow.run.action",
    payload: { runId, stepKey: run.stepKey, action, from: run.status, to: target },
  });

  // Best-effort enqueue for the scheduler; the run row is the source of truth so
  // the manual path still works if Inngest is unconfigured.
  if (target === "scheduled" && integrations.inngest()) {
    try {
      await inngest.send({
        name: "pulse/flow.run.scheduled",
        data: { runId, creatorId: run.creatorId, stepKey: run.stepKey },
      });
    } catch {
      /* non-fatal: the cron sweep will still pick up scheduled runs */
    }
  }

  return NextResponse.json({ ok: true, run: updated });
}
