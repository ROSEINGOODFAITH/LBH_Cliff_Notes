import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators, outreachEvents, payouts } from "@/db/schema";
import { claude, parseClaudeJson, smartleadReply } from "@/lib/integrations";
import { suggestedRateUsd } from "@/lib/model";

export const repliesWebhook = inngest.createFunction(
  { id: "pulse-replies-webhook" },
  { event: "smartlead/reply.received" },
  async ({ event, step }) => {
    const { email, replyBody, campaignId } = event.data;
    const c = (await db.select().from(creators).where(eq(creators.email, email)))[0];
    if (!c || ["rejected", "churned", "paid"].includes(c.stage)) return;
    const ai = await step.run("classify", async () => parseClaudeJson(await claude(
      `Classify this influencer reply to a brand outreach email. Reply: """${String(replyBody).slice(0, 2000)}"""
Return ONLY JSON: {"classification": "interested"|"negotiating"|"later"|"no"}`)));
    await step.run("log", () => db.insert(outreachEvents).values({
      creatorId: c.id, type: "replied", classification: ai.classification, payload: event.data,
    }));
    if (ai.classification === "interested") {
      await step.run("send-tally", () => smartleadReply(campaignId, email,
        `Amazing! Grab your spot here and we'll ship PULSE this week: ${process.env.TALLY_FORM_URL}?handle=${encodeURIComponent(c.handle)}`));
      await step.run("stage", () => db.update(creators).set({ stage: "replied", updatedAt: new Date() }).where(eq(creators.id, c.id)));
    } else if (ai.classification === "negotiating" && c.tier === "A") {
      await step.run("pending-payout", () => db.insert(payouts).values({
        creatorId: c.id, half: "signing", amountUsd: suggestedRateUsd(c.avgViews), status: "pending",
      }));
      await step.run("stage", () => db.update(creators).set({ stage: "replied", updatedAt: new Date() }).where(eq(creators.id, c.id)));
    } else if (ai.classification === "no") {
      await step.run("churn", () => db.update(creators).set({ stage: "churned", updatedAt: new Date() }).where(eq(creators.id, c.id)));
    }
  });
