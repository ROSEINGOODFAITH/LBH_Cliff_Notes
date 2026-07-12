import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isProvisioned,
  funnelFromStages,
  stageMeta,
  STAGE_META,
  canTransition,
  assertTransition,
  InvalidStageTransition,
  advanceStage,
  statusToStage,
  isTerminalStage,
  ENGAGED_STAGES,
} from "../src/lib/lifecycle";

test("isProvisioned — the gift-order idempotency guard", async (t) => {
  await t.test("false when neither code nor draft order exists", () => {
    assert.equal(isProvisioned({}), false);
    assert.equal(isProvisioned({ discountCode: null, shopifyDraftOrderId: null }), false);
    assert.equal(isProvisioned({ discountCode: "" }), false);
  });

  await t.test("true once a discount code is minted (smartlead branch)", () => {
    assert.equal(isProvisioned({ discountCode: "PULSE-ABC123" }), true);
  });

  await t.test("true once a draft order is placed (direct-ship branch)", () => {
    assert.equal(isProvisioned({ shopifyDraftOrderId: "998877" }), true);
  });

  // The whole point: a redelivered `creator.tiered` event must short-circuit so
  // no second free gift order is created.
  await t.test("stays true across a re-fired event with both fields set", () => {
    assert.equal(isProvisioned({ discountCode: "PULSE-X", shopifyDraftOrderId: "1" }), true);
  });
});

test("funnelFromStages — canonical, cumulative funnel from stage counts", async (t) => {
  await t.test("empty input yields all zeros", () => {
    assert.deepEqual(funnelFromStages([]), {
      discovered: 0,
      contacted: 0,
      replied: 0,
      active: 0,
      posted: 0,
    });
  });

  await t.test("buckets are cumulative down the happy path", () => {
    const rows = [
      { stage: "sourced", n: 5 },
      { stage: "review", n: 3 },
      { stage: "contacted", n: 4 },
      { stage: "replied", n: 2 },
      { stage: "onboarded", n: 1 },
      { stage: "shipped", n: 1 },
      { stage: "posted", n: 2 },
      { stage: "paid", n: 1 },
    ];
    const f = funnelFromStages(rows);
    assert.equal(f.discovered, 19, "discovered = everyone in the table");
    // contacted+ = contacted..paid = 4+2+1+1+2+1
    assert.equal(f.contacted, 11);
    // replied+ = replied..paid = 2+1+1+2+1
    assert.equal(f.replied, 7);
    // active = onboarded..paid = 1+1+2+1
    assert.equal(f.active, 5);
    // posted = posted+paid = 2+1
    assert.equal(f.posted, 3);
    // monotonic narrowing
    assert.ok(f.discovered >= f.contacted);
    assert.ok(f.contacted >= f.replied);
    assert.ok(f.replied >= f.active);
    assert.ok(f.active >= f.posted);
  });

  await t.test("negative terminal stages count only toward discovered", () => {
    const f = funnelFromStages([
      { stage: "sourced", n: 2 },
      { stage: "rejected", n: 3 },
      { stage: "churned", n: 4 },
    ]);
    assert.equal(f.discovered, 9);
    assert.equal(f.contacted, 0);
    assert.equal(f.replied, 0);
    assert.equal(f.active, 0);
    assert.equal(f.posted, 0);
  });

  await t.test("accepts string counts (as Postgres/drizzle may return)", () => {
    const f = funnelFromStages([{ stage: "posted", n: "3" }]);
    assert.equal(f.posted, 3);
    assert.equal(f.discovered, 3);
  });
});

test("stageMeta — consistent labels for every enum value", async (t) => {
  await t.test("onboarded and shipped both read as 'Shipping' to the operator", () => {
    assert.equal(stageMeta("onboarded").label, "Shipping");
    assert.equal(stageMeta("shipped").label, "Shipping");
  });

  await t.test("unknown / null stage falls back to 'Found' rather than crashing", () => {
    assert.equal(stageMeta(null).label, STAGE_META.sourced.label);
    assert.equal(stageMeta(undefined).label, STAGE_META.sourced.label);
    assert.equal(stageMeta("bogus").label, STAGE_META.sourced.label);
  });

  await t.test("review is the only 'attention' (needs-operator) stage", () => {
    const attention = Object.entries(STAGE_META)
      .filter(([, m]) => m.tone === "attention")
      .map(([k]) => k);
    assert.deepEqual(attention, ["review"]);
  });
});

test("canTransition / assertTransition — the canonical state machine", async (t) => {
  await t.test("allows valid forward edges", () => {
    assert.ok(canTransition("sourced", "review"));
    assert.ok(canTransition("review", "contacted"));
    assert.ok(canTransition("review", "onboarded")); // direct-ship approval
    assert.ok(canTransition("contacted", "replied"));
    assert.ok(canTransition("onboarded", "shipped"));
    assert.ok(canTransition("posted", "paid"));
  });

  await t.test("any non-terminal stage may churn (opt-out)", () => {
    for (const s of ["sourced", "review", "contacted", "replied", "onboarded", "shipped", "posted"] as const) {
      assert.ok(canTransition(s, "churned"), `${s} → churned`);
    }
  });

  await t.test("rejects regressions and revivals", () => {
    assert.equal(canTransition("paid", "contacted"), false);
    assert.equal(canTransition("posted", "replied"), false);
    assert.equal(canTransition("shipped", "onboarded"), false);
    assert.equal(canTransition("rejected", "contacted"), false);
    assert.equal(canTransition("churned", "sourced"), false);
  });

  await t.test("a no-op (same stage) is always valid", () => {
    assert.ok(canTransition("paid", "paid"));
    assert.ok(canTransition("sourced", "sourced"));
  });

  await t.test("assertTransition throws InvalidStageTransition on a bad edge", () => {
    assert.throws(() => assertTransition("paid", "sourced"), InvalidStageTransition);
    assert.doesNotThrow(() => assertTransition("sourced", "contacted"));
  });

  await t.test("terminal stages are exactly paid/rejected/churned", () => {
    assert.deepEqual(
      (["sourced", "review", "contacted", "replied", "onboarded", "shipped", "posted", "paid", "rejected", "churned"] as const)
        .filter(isTerminalStage),
      ["paid", "rejected", "churned"],
    );
  });
});

test("advanceStage — monotonic forward progress, no regressions or revivals", async (t) => {
  await t.test("moves forward when target is further along", () => {
    assert.equal(advanceStage("sourced", "onboarded"), "onboarded");
    assert.equal(advanceStage("contacted", "replied"), "replied");
  });

  await t.test("never regresses a more-advanced creator", () => {
    assert.equal(advanceStage("posted", "onboarded"), "posted");
    assert.equal(advanceStage("replied", "contacted"), "replied");
  });

  await t.test("terminal stages are sticky and targets that are terminal are ignored", () => {
    assert.equal(advanceStage("paid", "onboarded"), "paid");
    assert.equal(advanceStage("churned", "onboarded"), "churned");
    assert.equal(advanceStage("contacted", "churned"), "contacted"); // use an explicit transition for removals
  });
});

test("statusToStage — legacy CRM status maps onto the canonical stage", async (t) => {
  await t.test("maps every legacy value", () => {
    assert.equal(statusToStage("prospect"), "sourced");
    assert.equal(statusToStage("contacted"), "contacted");
    assert.equal(statusToStage("replied"), "replied");
    assert.equal(statusToStage("negotiating"), "replied");
    assert.equal(statusToStage("active"), "onboarded");
    assert.equal(statusToStage("declined"), "rejected");
    assert.equal(statusToStage("dormant"), "churned");
  });

  await t.test("null / unknown falls back to sourced", () => {
    assert.equal(statusToStage(null), "sourced");
    assert.equal(statusToStage(undefined), "sourced");
    assert.equal(statusToStage("bogus"), "sourced");
  });
});

test("ENGAGED_STAGES — replied through paid (replaces legacy active|negotiating|replied)", () => {
  assert.deepEqual(ENGAGED_STAGES, ["replied", "onboarded", "shipped", "posted", "paid"]);
});
