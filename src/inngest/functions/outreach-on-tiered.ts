import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators, outreachEvents } from "@/db/schema";
import { smartleadPushLead } from "@/lib/integrations";
import { createSeedingDiscountCode, createGiftDraftOrder } from "@/lib/shopify";
import { isProvisioned } from "@/lib/lifecycle";
import { claimGift, completeGift, failGift } from "@/lib/provisioning";

export const outreachOnTiered = inngest.createFunction(
  { id: "pulse-outreach-on-tiered" },
  { event: "creator.tiered" },
  async ({ event, step }) => {
    const c = (await db.select().from(creators).where(eq(creators.id, event.data.creatorId)))[0];
    const shipping = (c?.sourceMetadata as any)?.shipping ?? null;
    if (!c || !["A", "B"].includes(c.tier ?? "") || (!c.email && !shipping)) return;
    // Cheap idempotency short-circuit (defense in depth): a code or draft order
    // already means this ran. The authoritative guard is the DB claim below.
    if (isProvisioned(c)) return;

    // Atomically claim provisioning BEFORE any Shopify side effect. Inngest
    // delivers at-least-once and two workers can race; exactly one wins the
    // claim row. A loser gets null and must abort — no second (free) order.
    const claim = await step.run("claim-gift", () => claimGift(c.id));
    if (!claim) return;

    try {
      const code = "PULSE-" + c.handle.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
      const disc = await step.run("shopify-code", () => createSeedingDiscountCode(code));
      if (shipping) {
        // Address already on file (they filled the form) — skip the invite, ship now.
        const draft = await step.run("draft-order", () => createGiftDraftOrder({
          variantId: process.env.PULSE_SEEDING_VARIANT_ID!, shipping,
          creatorId: c.id, handle: c.handle, tier: c.tier,
        }));
        const draftOrderId = String(draft.draft_order.id);
        await step.run("save", async () => {
          await db.update(creators).set({
            discountCode: code, shopifyDraftOrderId: draftOrderId,
            stage: "onboarded", updatedAt: new Date(),
          }).where(eq(creators.id, c.id));
          await db.insert(outreachEvents).values({ creatorId: c.id, type: "pushed", payload: { directShip: true, shopifyDiscount: disc } as any });
        });
        await step.run("complete-claim", () => completeGift(claim.id, { draftOrderId, discountCode: code }));
        return;
      }
      const campaignId = c.tier === "A" ? process.env.SMARTLEAD_CAMPAIGN_TIER_A! : process.env.SMARTLEAD_CAMPAIGN_TIER_B!;
      const res = await step.run("smartlead-push", () => smartleadPushLead(campaignId, {
        email: c.email!, first_name: c.handle,
        custom_fields: { handle: c.handle, first_line: (c.sourceMetadata as any)?.firstLine ?? "", code },
      }));
      await step.run("save", async () => {
        await db.update(creators).set({ discountCode: code, stage: "contacted", updatedAt: new Date() }).where(eq(creators.id, c.id));
        await db.insert(outreachEvents).values({ creatorId: c.id, type: "pushed", payload: { smartlead: res, shopifyDiscount: disc } as any });
      });
      await step.run("complete-claim", () => completeGift(claim.id, { discountCode: code }));
    } catch (err) {
      // Release the claim so a later redelivery can retry (claimGift revives a
      // `failed` row). Re-throw so Inngest records the failure.
      await step.run("fail-claim", () => failGift(claim.id, err));
      throw err;
    }
  });
