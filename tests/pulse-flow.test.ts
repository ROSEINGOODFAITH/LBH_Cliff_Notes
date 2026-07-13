import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cloneDefaultFlow,
  relink,
  moveStep,
  removeStep,
  validateFlow,
  flowHasErrors,
  isFlowValid,
  runActionTarget,
  canRunTransition,
  suggestNextAction,
  isReviewNextAction,
  AUTO_SEND_ALLOWLIST,
  type FlowStep,
} from "../src/lib/pulse-flow";

function step(key: string, over: Partial<FlowStep> = {}): FlowStep {
  return {
    key,
    name: key,
    actionType: "qualify",
    stage: null,
    tiers: ["COLD", "WARM", "FAM"],
    templateKey: null,
    delayMinutes: null,
    approvalRequired: true,
    autoSendsExternal: false,
    enabled: true,
    nextStepKey: null,
    ...over,
  };
}

test("default flow is valid and has no errors", () => {
  const flow = relink(cloneDefaultFlow());
  assert.equal(flowHasErrors(flow), false);
  assert.equal(isFlowValid(flow), true);
  assert.deepEqual(validateFlow(flow), []);
});

test("relink threads nextStepKey by array order; last is null", () => {
  const flow = relink([step("a"), step("b"), step("c")]);
  assert.equal(flow[0].nextStepKey, "b");
  assert.equal(flow[1].nextStepKey, "c");
  assert.equal(flow[2].nextStepKey, null);
});

test("moveStep swaps and re-links; out-of-range is a no-op", () => {
  const flow = relink([step("a"), step("b"), step("c")]);
  const moved = moveStep(flow, 0, 1);
  assert.deepEqual(moved.map((s) => s.key), ["b", "a", "c"]);
  assert.equal(moved[0].nextStepKey, "a"); // re-linked to new order
  assert.equal(moved[2].nextStepKey, null);
  // no-op at the edges
  assert.deepEqual(moveStep(flow, 0, -1).map((s) => s.key), ["a", "b", "c"]);
  assert.deepEqual(moveStep(flow, 2, 1).map((s) => s.key), ["a", "b", "c"]);
});

test("removeStep drops the step and re-links around the gap", () => {
  const flow = relink([step("a"), step("b"), step("c")]);
  const out = removeStep(flow, "b");
  assert.deepEqual(out.map((s) => s.key), ["a", "c"]);
  assert.equal(out[0].nextStepKey, "c");
});

test("validateFlow flags missing template on an enabled draft step", () => {
  const flow = relink([step("d", { actionType: "draft", templateKey: null })]);
  const issues = validateFlow(flow);
  assert.ok(issues.some((i) => i.code === "missing_template" && i.severity === "error"));
});

test("validateFlow ignores a DISABLED step's runtime requirements", () => {
  const flow = relink([step("d", { actionType: "draft", templateKey: null, enabled: false })]);
  assert.equal(flowHasErrors(flow), false);
});

test("validateFlow flags missing/zero delay on a wait step", () => {
  const bad = relink([step("w", { actionType: "wait", delayMinutes: 0 })]);
  assert.ok(validateFlow(bad).some((i) => i.code === "missing_delay"));
  const ok = relink([step("w", { actionType: "wait", delayMinutes: 60 })]);
  assert.equal(validateFlow(ok).some((i) => i.code === "missing_delay"), false);
});

test("validateFlow flags an external send that auto-sends without approval", () => {
  const flow = relink([
    step("s", { actionType: "send_email", templateKey: "invite", autoSendsExternal: true, approvalRequired: false }),
  ]);
  assert.ok(validateFlow(flow).some((i) => i.code === "external_send_without_approval" && i.severity === "error"));
});

test("allow-listed key may auto-send without an approval flag", () => {
  const key = [...AUTO_SEND_ALLOWLIST][0];
  const flow = relink([
    step(key, { actionType: "send_email", templateKey: "invite", autoSendsExternal: true, approvalRequired: false }),
  ]);
  assert.equal(validateFlow(flow).some((i) => i.code === "external_send_without_approval"), false);
});

test("validateFlow detects duplicate ids", () => {
  const flow = [step("dup"), step("dup")];
  assert.ok(validateFlow(flow).some((i) => i.code === "duplicate_id"));
});

test("validateFlow detects an invalid next reference", () => {
  const flow = [step("a", { nextStepKey: "ghost" })];
  assert.ok(validateFlow(flow).some((i) => i.code === "invalid_next_ref"));
});

test("validateFlow detects a cycle", () => {
  const flow = [step("a", { nextStepKey: "b" }), step("b", { nextStepKey: "a" })];
  assert.ok(validateFlow(flow).some((i) => i.code === "cycle"));
});

test("validateFlow warns about an unreachable step", () => {
  // a -> b (end); c dangles unreachable from the start
  const flow = [step("a", { nextStepKey: "b" }), step("b", { nextStepKey: null }), step("c", { nextStepKey: null })];
  const issues = validateFlow(flow);
  assert.ok(issues.some((i) => i.code === "unreachable" && i.severity === "warning"));
});

/* ------------------------------ run transitions --------------------------- */

test("runActionTarget: approve only lifts an approval_needed run to scheduled", () => {
  assert.equal(runActionTarget("approve", "approval_needed"), "scheduled");
  assert.equal(runActionTarget("approve", "pending"), null);
  assert.equal(runActionTarget("approve", "scheduled"), null);
});

test("runActionTarget: retry only from failed; reschedule from scheduled/waiting", () => {
  assert.equal(runActionTarget("retry", "failed"), "scheduled");
  assert.equal(runActionTarget("retry", "pending"), null);
  assert.equal(runActionTarget("reschedule", "scheduled"), "scheduled");
  assert.equal(runActionTarget("reschedule", "waiting"), "scheduled");
  assert.equal(runActionTarget("reschedule", "pending"), null);
});

test("runActionTarget: skip and cancel are broadly available; completed is terminal", () => {
  assert.equal(runActionTarget("skip", "pending"), "skipped");
  assert.equal(runActionTarget("cancel", "scheduled"), "cancelled");
  assert.equal(runActionTarget("skip", "completed"), null);
  assert.equal(runActionTarget("cancel", "completed"), null);
});

test("canRunTransition: a run can never leave completed", () => {
  assert.equal(canRunTransition("completed", "scheduled"), false);
  assert.equal(canRunTransition("completed", "completed"), true);
});

/* ------------------------------ suggestions ------------------------------- */

test("suggestNextAction maps tier -> suggested action (never a stage change)", () => {
  assert.equal(suggestNextAction("COLD"), "qualify");
  assert.equal(suggestNextAction("WARM"), "draft_invite");
  assert.equal(suggestNextAction("FAM"), "add_to_campaign");
  assert.equal(suggestNextAction(null), "qualify");
});

test("isReviewNextAction guards the allowed set", () => {
  assert.equal(isReviewNextAction("qualify"), true);
  assert.equal(isReviewNextAction("replied"), false);
  assert.equal(isReviewNextAction(123), false);
});
