import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGiftDraftOrderPayload,
  giftIdempotencyKey,
  GIFT_DISCOUNT_TITLE,
  GIFT_DISCOUNT_DESCRIPTION,
} from "../src/lib/shopify";
import { isProvisioned } from "../src/lib/lifecycle";

const baseInput = {
  variantId: "44556677",
  shipping: { address1: "1 Laurel Way", city: "Austin", province: "TX", zip: "78701", country: "US" },
  creatorId: "creator-123",
  handle: "aria",
  tier: "A",
};

test("buildGiftDraftOrderPayload — the gift is actually free", async (t) => {
  await t.test("applies an order-level 100% percentage discount", () => {
    const { draft_order } = buildGiftDraftOrderPayload(baseInput);
    assert.equal(draft_order.applied_discount.value_type, "percentage");
    assert.equal(draft_order.applied_discount.value, "100.0");
  });

  await t.test("the discount carries a human-readable title and reason", () => {
    const { draft_order } = buildGiftDraftOrderPayload(baseInput);
    assert.equal(draft_order.applied_discount.title, GIFT_DISCOUNT_TITLE);
    assert.equal(draft_order.applied_discount.title, "LBH Creator Gift");
    assert.equal(draft_order.applied_discount.description, GIFT_DISCOUNT_DESCRIPTION);
  });

  // Preserving the line price (rather than a $0 line item) is what keeps the
  // gifted merchandise value visible for reporting — the discount zeroes the
  // total, not the line.
  await t.test("preserves the variant and quantity on the line item (no $0 price override)", () => {
    const { draft_order } = buildGiftDraftOrderPayload(baseInput);
    assert.deepEqual(draft_order.line_items, [{ variant_id: 44556677, quantity: 1 }]);
    assert.equal("price" in (draft_order.line_items[0] as object), false);
  });
});

test("buildGiftDraftOrderPayload — creator correlation / idempotency metadata", async (t) => {
  await t.test("stamps a deterministic per-creator idempotency key", () => {
    assert.equal(giftIdempotencyKey("creator-123"), "pulse-gift-creator-123");
    const { draft_order } = buildGiftDraftOrderPayload(baseInput);
    const attrs = Object.fromEntries(draft_order.note_attributes.map((a) => [a.name, a.value]));
    assert.equal(attrs.pulse_creator_id, "creator-123");
    assert.equal(attrs.pulse_idempotency_key, "pulse-gift-creator-123");
    assert.equal(attrs.pulse_reason, GIFT_DISCOUNT_DESCRIPTION);
  });

  await t.test("the idempotency key is also on tags for human-side dedup", () => {
    const { draft_order } = buildGiftDraftOrderPayload(baseInput);
    assert.match(draft_order.tags, /pulse-seeding/);
    assert.match(draft_order.tags, /pulse-gift-creator-123/);
  });

  await t.test("the same creator always yields the same key (retry-safe reference)", () => {
    const a = buildGiftDraftOrderPayload(baseInput);
    const b = buildGiftDraftOrderPayload({ ...baseInput, handle: "renamed" });
    assert.equal(
      a.draft_order.note_attributes.find((x) => x.name === "pulse_idempotency_key")!.value,
      b.draft_order.note_attributes.find((x) => x.name === "pulse_idempotency_key")!.value,
    );
  });

  await t.test("falls back to a generated note but respects an explicit one", () => {
    assert.match(buildGiftDraftOrderPayload(baseInput).draft_order.note, /@aria — Tier A/);
    assert.equal(buildGiftDraftOrderPayload({ ...baseInput, note: "custom" }).draft_order.note, "custom");
  });
});

// The builder is pure; the "don't provision twice" guarantee lives in the guard
// the callers apply before ever building a payload. This asserts that contract.
test("provisioning is skipped when a creator is already provisioned", () => {
  assert.equal(isProvisioned({ shopifyDraftOrderId: "998877" }), true);
  assert.equal(isProvisioned({ discountCode: "PULSE-ABC" }), true);
  assert.equal(isProvisioned({}), false);
});
