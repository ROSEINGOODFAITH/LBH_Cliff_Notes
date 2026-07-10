import { and, eq, sql } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators, outreachEvents } from "@/db/schema";
import { smartleadReply } from "@/lib/integrations";

const DAY = 864e5;

export const activationCheck = inngest.createFunction(
  { id: "pulse-activation-check" },
  { cron: "0 16 * * *" },
  async ({ step }) => {
    const shipped = await db.select().from(creators).where(eq(creators.stage, "shipped"));
    for (const c of shipped) {
      if (c.postUrl) {
        await step.run(`posted-${c.id}`, () => db.update(creators).set({ stage: "posted", postVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(creators.id, c.id)));
        await step.sendEvent(`emit-${c.id}`, { name: "creator.posted", data: { creatorId: c.id } });
        continue;
      }
      // nudges only after 10 quiet days
      if (c.updatedAt > new Date(Date.now() - 10 * DAY)) continue;
      const nudges = await db.select({ n: sql<number>`count(*)` }).from(outreachEvents)
        .where(and(eq(outreachEvents.creatorId, c.id), eq(outreachEvents.type, "nudge_sent")));
      const count = Number(nudges[0]?.n ?? 0);
      if (count >= 2) {
        await step.run(`churn-${c.id}`, () => db.update(creators).set({ stage: "churned", updatedAt: new Date() }).where(eq(creators.id, c.id)));
      } else if (c.email) {
        const campaignId = c.tier === "A" ? process.env.SMARTLEAD_CAMPAIGN_TIER_A! : process.env.SMARTLEAD_CAMPAIGN_TIER_B!;
        await step.run(`nudge-${c.id}`, async () => {
          // Best-effort — see fulfill-poll: log failures, never wedge the cron.
          let sent: unknown;
          try {
            sent = await smartleadReply(campaignId, c.email!,
              `Hi ${c.handle}! Hope PULSE landed safely — no rush at all, just checking if you have everything you need for your post. Your code ${c.discountCode} is live whenever you are.`);
          } catch (e) {
            console.warn(`[pulse] nudge email failed for @${c.handle}:`, String(e).slice(0, 400));
            sent = { __unavailable: String(e).slice(0, 300) };
          }
          await db.insert(outreachEvents).values({ creatorId: c.id, type: "nudge_sent", payload: { nudge: count + 1, smartlead: sent } });
        });
      }
    }
    return { checked: shipped.length };
  });
