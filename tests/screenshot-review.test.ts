import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultStageForUpload,
  validateConfirm,
  buildReviewModel,
  normalizeHandle,
  field,
  LOW_CONFIDENCE,
  type ExtractedProfile,
} from "../src/lib/screenshot";
import {
  coerceRelationshipTier,
  isRelationshipTier,
  DEFAULT_RELATIONSHIP_TIER,
} from "../src/lib/relationship";
import { describeGmailIdentity, EXPECTED_SENDER } from "../src/lib/gmail-identity";

/* The cardinal safety rule: an uploaded screenshot never marks a creator as
 * replied/contacted, and the default stage is always the earliest prospect. */
test("default stage for a screenshot upload is 'sourced', never replied/contacted", () => {
  assert.equal(defaultStageForUpload(), "sourced");
  assert.notEqual(defaultStageForUpload(), "replied");
  assert.notEqual(defaultStageForUpload(), "contacted");
});

test("relationship tier is a separate axis; default is COLD and independent of stage", () => {
  assert.equal(DEFAULT_RELATIONSHIP_TIER, "COLD");
  assert.equal(coerceRelationshipTier("warm"), "WARM");
  assert.equal(coerceRelationshipTier("FAM"), "FAM");
  assert.equal(coerceRelationshipTier("replied"), null); // a stage is not a tier
  assert.equal(coerceRelationshipTier("hot"), null);
  assert.equal(isRelationshipTier("COLD"), true);
  assert.equal(isRelationshipTier("sourced"), false);
});

test("validateConfirm requires a valid handle and never touches stage", () => {
  const ok = validateConfirm({ handle: "@Cool.Creator", platform: "tiktok", email: "a@b.com" });
  assert.equal(ok.ok, true);
  assert.equal(ok.handle, "cool.creator");
  assert.equal(ok.platform, "tiktok");
  assert.equal(ok.email, "a@b.com");
  assert.ok(!("stage" in ok));

  const noHandle = validateConfirm({ handle: "" });
  assert.equal(noHandle.ok, false);
  assert.ok(noHandle.errors.length > 0);

  const badEmail = validateConfirm({ handle: "creator", email: "not-an-email" });
  assert.equal(badEmail.ok, false);
});

test("validateConfirm only accepts known platforms, else null (no guessing)", () => {
  assert.equal(validateConfirm({ handle: "creator", platform: "instagram" }).platform, "instagram");
  assert.equal(validateConfirm({ handle: "creator", platform: "youtube" }).platform, null);
});

test("normalizeHandle strips urls/@ and lowercases", () => {
  assert.equal(normalizeHandle("https://www.tiktok.com/@Foo.Bar?lang=en"), "foo.bar");
  assert.equal(normalizeHandle("@Foo_Bar"), "foo_bar");
  assert.equal(normalizeHandle("https://instagram.com/foo"), "foo");
});

test("field() clamps confidence and zeroes it when there is no value", () => {
  assert.deepEqual(field("x", 0.42), { value: "x", confidence: 0.42 });
  assert.deepEqual(field("x", 5), { value: "x", confidence: 1 });
  assert.deepEqual(field(null, 0.9), { value: null, confidence: 0 });
});

test("buildReviewModel flags missing + low-confidence fields and sets safe defaults", () => {
  const profile: ExtractedProfile = {
    handle: field("creator", 0.95),
    platform: field("tiktok", 0.9),
    displayName: field("Creator", 0.4), // low confidence
    email: field(null, 0), // missing
    followerCount: field(1200, 0.8),
    bio: field(null, 0),
    profileUrl: field(null, 0),
  };
  const model = buildReviewModel(profile);
  assert.equal(model.defaultStage, "sourced");
  assert.equal(model.defaultTier, "COLD");
  assert.ok(model.missing.includes("email"));
  assert.ok(model.lowConfidence.includes("displayName"));
  assert.ok(LOW_CONFIDENCE === 0.6);
});

/* ------------------------------ Gmail gate -------------------------------- */

test("describeGmailIdentity: a matching connected account can send", () => {
  const id = describeGmailIdentity({ configured: true, connectedEmail: EXPECTED_SENDER, demo: false });
  assert.equal(id.status, "connected");
  assert.equal(id.canSend, true);
});

test("describeGmailIdentity: a wrong account is blocked from sending", () => {
  const id = describeGmailIdentity({ configured: true, connectedEmail: "someone@else.com", demo: false });
  assert.equal(id.status, "wrong_account");
  assert.equal(id.canSend, false);
});

test("describeGmailIdentity: not connected and demo both block sending", () => {
  assert.equal(describeGmailIdentity({ configured: false, connectedEmail: null, demo: false }).canSend, false);
  const demo = describeGmailIdentity({ configured: true, connectedEmail: EXPECTED_SENDER, demo: true });
  assert.equal(demo.status, "demo");
  assert.equal(demo.canSend, false);
});
