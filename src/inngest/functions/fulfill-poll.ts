import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators, outreachEvents } from "@/db/schema";
import { shopifyGetOrderFulfillment, smartleadReply } from "@/lib/integrations";

export const fulfillPoll = inngest.createFunction(
  { id: "pulse-fulfill-poll" },
  { cron: "0 * * * *" },
  async ({ step }) => {
    const open = await db.select().from(creators).where(eq(creators.stage, "onboarded"));
    for (const c of open) {
      if (!c.shopifyDraftOrderId) continue;
      const tracking = await step.run(`track-${c.id}`, () => shopifyGetOrderFulfillment(c.shopifyDraftOrderId!));
      if (tracking) {
        await step.run(`ship-${c.id}`, async () => {
          await db.update(creators).set({ trackingNumber: String(tracking), stage: "shipped", updatedAt: new Date() }).where(eq(creators.id, c.id));
        });
        if (c.email) {
          const campaignId = c.tier === "A" ? process.env.SMARTLEAD_CAMPAIGN_TIER_A! : process.env.SMARTLEAD_CAMPAIGN_TIER_B!;
          await step.run(`shipped-email-${c.id}`, async () => {
            const sent = await smartleadReply(campaignId, c.email!,
              `PULSE is on its way! Tracking: ${tracking}\n\n` +
              `Your creative brief: ${process.env.CREATIVE_BRIEF_URL ?? "(brief link)"}\n` +
              `Your code (15% off for your audience, commission tracked to you): ${c.discountCode}\n\n` +
              `One tiny string: if you post, tag it #ad or flip on TikTok's paid-partnership label. ` +
              `Otherwise — no pressure, and thank you. — David & Laura, Laurel Bath House`);
            await db.insert(outreachEvents).values({ creatorId: c.id, type: "sent", classification: null, payload: { shippedEmail: true, tracking, smartlead: sent } });
          });
        }
      }
    }
    return { checked: open.length };
  });
