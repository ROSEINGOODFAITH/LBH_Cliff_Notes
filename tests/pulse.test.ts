import { test } from "node:test";
import assert from "node:assert/strict";
import { pulseFit, spamRisk, matchAngles, PULSE_ANGLES } from "../src/lib/pulse-fit";
import {
  computeCockpit,
  phaseForStage,
  PHASES,
  type StageCount,
} from "../src/lib/pulse-phases";
import { suggestRing, isRingKey, ringMeta, RING_KEYS } from "../src/lib/pulse-rings";
import { renderTemplate, TEMPLATE_KEYS } from "../src/lib/pulse-templates";
import {
  assertAutoSendGuardrails,
  enabledRules,
  AUTOMATION_RULES,
  type AutomationRule,
} from "../src/lib/pulse-automations";

/* ============================== pulse-fit ================================== */

test("pulseFit — explainable rubric out of 100", async (t) => {
  await t.test("a strong on-brief creator scores high with full data", () => {
    const f = pulseFit({
      handle: "scentqueen",
      followerCount: 60_000,
      engagementRate: 0.06,
      avgViews: 40_000,
      fakeFollowerPct: 3,
      geo: "US",
      niche: "fragrance",
      nicheTags: ["fragrance", "beauty", "80s"],
      aestheticScore: 85,
      signals: { buyingIntentComments: 15, categoryPostCount: 8, postsPerWeek: 4 },
    });
    assert.ok(f.score >= 80, `expected high score, got ${f.score}`);
    assert.equal(f.baseScore, f.score, "no spam penalty for a clean profile");
    assert.equal(f.confidence, 1, "all five components backed by real data");
    assert.equal(f.components.reduce((s, c) => s + c.score, 0), f.baseScore);
  });

  await t.test("missing inputs lower confidence and are reported, not assumed", () => {
    const f = pulseFit({ handle: "mystery", niche: "fragrance" });
    assert.ok(f.confidence < 1);
    assert.ok(f.missing.length > 0);
    // components with absent inputs are flagged estimated
    assert.ok(f.components.some((c) => c.estimated));
    // never invents data: score stays within bounds
    assert.ok(f.score >= 0 && f.score <= 100);
  });

  await t.test("component maxima sum to 100 and each stays within its cap", () => {
    const f = pulseFit({ followerCount: 50_000, geo: "US", niche: "fragrance", aestheticScore: 100 });
    assert.equal(f.components.reduce((s, c) => s + c.max, 0), 100);
    for (const c of f.components) assert.ok(c.score <= c.max, `${c.key} over cap`);
  });

  await t.test("spam risk discounts the score but never zeroes a clean base", () => {
    const clean = pulseFit({ followerCount: 50_000, geo: "US", niche: "fragrance", aestheticScore: 80 });
    const flagged = pulseFit({
      followerCount: 50_000,
      geo: "US",
      niche: "fragrance",
      aestheticScore: 80,
      fakeFollowerPct: 45,
      engagementRate: 0.002,
    });
    assert.ok(flagged.spamRisk.flag);
    assert.ok(flagged.score < clean.score, "flagged score is penalized");
    assert.ok(flagged.score > 0, "penalty is proportional, not a hard zero");
  });
});

test("spamRisk — conservative, fully explained", async (t) => {
  await t.test("a manual flag is absolute", () => {
    const r = spamRisk({ signals: { manualSpamFlag: true } });
    assert.equal(r.level, 1);
    assert.equal(r.flag, true);
    assert.equal(r.reasons.length, 1);
  });

  await t.test("clean profile has no risk and no reasons", () => {
    const r = spamRisk({ handle: "cleanuser", followerCount: 40_000, engagementRate: 0.05, fakeFollowerPct: 3 });
    assert.equal(r.level, 0);
    assert.equal(r.flag, false);
    assert.deepEqual(r.reasons, []);
  });

  await t.test("every point of risk carries a stated reason", () => {
    const r = spamRisk({ handle: "spam99231", followerCount: 200_000, engagementRate: 0.001, avgViews: 500, fakeFollowerPct: 40 });
    assert.ok(r.level > 0);
    assert.equal(r.reasons.length > 0, true);
  });
});

test("matchAngles — content/aesthetic categories only (no sensitive traits)", async (t) => {
  await t.test("maps niche keywords to PULSE angles", () => {
    const angles = matchAngles({ niche: "fragrance", nicheTags: ["leopard", "aerobics"] });
    const keys = angles.map((a) => a.key);
    assert.ok(keys.includes("fragrance"));
    assert.ok(keys.includes("leopard_power"));
    assert.ok(keys.includes("dance_fitness"));
  });

  await t.test("no niche data yields no angles (never guesses)", () => {
    assert.deepEqual(matchAngles({}), []);
  });

  await t.test("every angle has a usable outreach hook", () => {
    for (const a of PULSE_ANGLES) assert.ok(a.hook.length > 0);
  });
});

/* ============================= pulse-phases ================================ */

test("phaseForStage — canonical stage maps into exactly one phase", async (t) => {
  await t.test("known stages map as specified", () => {
    assert.equal(phaseForStage("sourced"), "discover");
    assert.equal(phaseForStage("review"), "qualify");
    assert.equal(phaseForStage("contacted"), "invite");
    assert.equal(phaseForStage("onboarded"), "gift");
    assert.equal(phaseForStage("shipped"), "delivered");
    assert.equal(phaseForStage("posted"), "content");
  });

  await t.test("nine ordered phases, define first and retain last", () => {
    assert.equal(PHASES.length, 9);
    assert.equal(PHASES[0].key, "define");
    assert.equal(PHASES[PHASES.length - 1].key, "retain");
  });
});

test("computeCockpit — deterministic cockpit from real stage counts", async (t) => {
  const counts = (o: Record<string, number>): StageCount[] =>
    Object.entries(o).map(([stage, n]) => ({ stage, n }));

  await t.test("empty pipeline: define is current, NBA is to add creators", () => {
    const c = computeCockpit({ stageCounts: [] });
    assert.equal(c.currentPhase, "define");
    assert.equal(c.totals.discovered, 0);
    assert.equal(c.nextBestAction.phase, "define"); // define incomplete outranks all
    assert.ok(c.readiness >= 0 && c.readiness <= 100);
  });

  await t.test("pending payouts win the Next Best Action over review queue", () => {
    const c = computeCockpit({
      stageCounts: counts({ review: 3, posted: 2, paid: 1 }),
      defineComplete: true,
      pendingPayouts: 2,
    });
    assert.match(c.nextBestAction.label, /Approve/);
    assert.ok(c.bottlenecks.length > 0);
    // review queue is still surfaced as a bottleneck
    assert.ok(c.bottlenecks.some((b) => b.phase === "qualify"));
  });

  await t.test("review queue drives current phase and a blocked qualify item", () => {
    const c = computeCockpit({ stageCounts: counts({ sourced: 4, review: 5 }), defineComplete: true });
    assert.equal(c.currentPhase, "qualify");
    const qualify = c.checklist.find((i) => i.phase === "qualify");
    assert.equal(qualify?.state, "blocked");
    assert.equal(qualify?.count, 5);
  });

  await t.test("funnel narrows monotonically with step-over-step conversion", () => {
    const c = computeCockpit({
      stageCounts: counts({ sourced: 10, contacted: 8, replied: 6, shipped: 4, posted: 2 }),
      defineComplete: true,
    });
    const byKey = Object.fromEntries(c.funnel.map((f) => [f.key, f]));
    assert.equal(byKey.discovered.conversion, null, "first step has no prior");
    // discovered >= contacted >= replied >= shipped >= posted
    const order = ["discovered", "contacted", "replied", "shipped", "posted"];
    for (let i = 1; i < order.length; i++) {
      assert.ok(byKey[order[i]].count <= byKey[order[i - 1]].count, `${order[i]} not narrowing`);
      assert.ok((byKey[order[i]].conversion ?? 0) >= 0 && (byKey[order[i]].conversion ?? 0) <= 1);
    }
  });

  await t.test("daysToLaunch computed from a launch date; null when absent", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const c = computeCockpit({ stageCounts: [], now, launchDate: "2026-01-11T00:00:00Z" });
    assert.equal(c.daysToLaunch, 10);
    const c2 = computeCockpit({ stageCounts: [], now });
    assert.equal(c2.daysToLaunch, null);
  });

  await t.test("readiness rises as milestones are proven", () => {
    const empty = computeCockpit({ stageCounts: [] }).readiness;
    const rolling = computeCockpit({
      stageCounts: counts({ sourced: 2, contacted: 3, shipped: 1, posted: 2 }),
      defineComplete: true,
    }).readiness;
    assert.ok(rolling > empty);
  });
});

/* ============================== pulse-rings ================================ */

test("suggestRing — audience-size recommendation (human confirms)", async (t) => {
  await t.test("bands map by follower count", () => {
    assert.equal(suggestRing({ followerCount: 250_000 }), "signal");
    assert.equal(suggestRing({ followerCount: 40_000 }), "editorial");
    assert.equal(suggestRing({ followerCount: 2_000 }), "advocate");
  });

  await t.test("first-party buyers bias to advocate regardless of size", () => {
    assert.equal(suggestRing({ followerCount: 500_000, source: "first_party" }), "advocate");
  });

  await t.test("missing follower count falls back to advocate (smallest claim)", () => {
    assert.equal(suggestRing({}), "advocate");
  });
});

test("isRingKey / ringMeta — validation + lookup", async (t) => {
  await t.test("accepts only the three known rings", () => {
    for (const k of RING_KEYS) assert.ok(isRingKey(k));
    assert.equal(isRingKey("bogus"), false);
    assert.equal(isRingKey(null), false);
    assert.equal(isRingKey(42), false);
  });

  await t.test("ringMeta returns job + nextAction, or null", () => {
    const m = ringMeta("signal");
    assert.ok(m && m.job.length > 0 && m.nextAction.length > 0);
    assert.equal(ringMeta(null), null);
    assert.equal(ringMeta("nope"), null);
  });
});

/* ============================ pulse-templates ============================== */

test("renderTemplate — fills tokens, falls back safely, never sends", async (t) => {
  await t.test("fills firstName, sender and brief tokens", () => {
    const r = renderTemplate("invite", { handle: "@velvet", firstName: "Mara", senderName: "David" });
    assert.match(r.body, /Hi Mara,/);
    assert.match(r.body, /— David/);
    assert.doesNotMatch(r.body, /\{\{|\}\}/, "no unrendered tokens remain");
  });

  await t.test("firstName falls back to the handle when absent", () => {
    const r = renderTemplate("invite", { handle: "@velvet" });
    assert.match(r.body, /Hi @velvet,/);
  });

  await t.test("paid_upgrade keeps the literal $ and renders the rate", () => {
    const r = renderTemplate("paid_upgrade", { handle: "gigi", rateUsd: 500 });
    assert.match(r.body, /\$500/);
    const fallback = renderTemplate("paid_upgrade", { handle: "gigi" });
    assert.match(fallback.body, /\$a fair rate/);
  });

  await t.test("every template renders with no leftover tokens", () => {
    for (const key of TEMPLATE_KEYS) {
      const r = renderTemplate(key, {
        handle: "creator",
        firstName: "Sam",
        trackingNumber: "1Z999",
        formUrl: "https://form",
        briefUrl: "https://brief",
        rateUsd: 300,
      });
      assert.doesNotMatch(r.subject, /\{\{|\}\}/, `${key} subject has tokens`);
      assert.doesNotMatch(r.body, /\{\{|\}\}/, `${key} body has tokens`);
    }
  });
});

/* =========================== pulse-automations ============================= */

test("assertAutoSendGuardrails — money never moves, no rogue auto-send", async (t) => {
  await t.test("the shipped default rule set passes", () => {
    assert.doesNotThrow(() => assertAutoSendGuardrails());
  });

  await t.test("only shipped-email is allowed to auto-send externally", () => {
    const autoSenders = AUTOMATION_RULES.filter((r) => r.autoSendsExternal).map((r) => r.id);
    assert.deepEqual(autoSenders, ["shipped-email"]);
  });

  await t.test("throws if a non-allow-listed rule turns on auto-send", () => {
    const rogue: AutomationRule[] = [
      { id: "rogue-blast", label: "Rogue", category: "notify", trigger: "x", action: "y",
        approvalRequired: false, autoSendsExternal: true, delay: "now", safeDefault: false,
        implementedBy: null, enabled: true },
    ];
    assert.throws(() => assertAutoSendGuardrails(rogue), /governed allow-list/);
  });

  await t.test("throws if a gift rule tries to auto-send/charge externally", () => {
    const rogue: AutomationRule[] = [
      { id: "gift-auto", label: "Auto gift", category: "gift", trigger: "x", action: "y",
        approvalRequired: false, autoSendsExternal: true, delay: "now", safeDefault: false,
        implementedBy: null, enabled: true },
    ];
    assert.throws(() => assertAutoSendGuardrails(rogue));
  });

  await t.test("enabledRules returns only rules whose capability ships", () => {
    const enabled = enabledRules();
    assert.ok(enabled.length > 0);
    assert.ok(enabled.every((r) => r.enabled));
    // the unwired draft rules are excluded
    assert.ok(!enabled.some((r) => r.id === "delivery-check-in"));
  });
});
