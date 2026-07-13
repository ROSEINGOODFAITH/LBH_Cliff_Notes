import { NextRequest, NextResponse } from "next/server";
import { getFlow, saveFlow } from "@/lib/pulse-flow-store";
import { validateFlow, type FlowStep } from "@/lib/pulse-flow";
import { getGmailIdentity } from "@/lib/gmail-identity";
import { ACTION_TYPES, REVIEW_NEXT_ACTIONS } from "@/lib/pulse-flow";
import { RELATIONSHIP_META } from "@/lib/relationship";

/** Read the active flow + its validation issues + the Gmail sender identity. */
export async function GET() {
  const [steps, identity] = await Promise.all([getFlow(), getGmailIdentity()]);
  return NextResponse.json({
    steps,
    issues: validateFlow(steps),
    identity,
    meta: { actionTypes: ACTION_TYPES, reviewActions: REVIEW_NEXT_ACTIONS, tiers: RELATIONSHIP_META },
  });
}

/** Save the full ordered flow. Rejected (422) if validation finds any error. */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const input = Array.isArray(body.steps) ? (body.steps as FlowStep[]) : null;
  if (!input) return NextResponse.json({ error: "steps array required" }, { status: 400 });

  const result = await saveFlow(input);
  if (!result.ok)
    return NextResponse.json({ error: "Flow has validation errors.", issues: result.issues }, { status: 422 });
  return NextResponse.json({ ok: true, steps: result.steps, issues: result.issues });
}
