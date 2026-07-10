import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators, payouts } from "@/db/schema";
import { claude, parseClaudeJson } from "@/lib/integrations";

export const complianceOnPosted = inngest.createFunction(
  { id: "pulse-compliance-on-posted" },
  { event: "creator.posted" },
  async ({ event, step }) => {
    const c = (await db.select().from(creators).where(eq(creators.id, event.data.creatorId)))[0];
    if (!c) return;
    if (c.tier === "B") {
      await step.run("complete-b", () => db.update(creators).set({ stage: "paid", updatedAt: new Date() }).where(eq(creators.id, c.id)));
      return;
    }
    const ai = await step.run("check-disclosure", async () => parseClaudeJson(await claude(
      `A paid TikTok post caption follows. Does it contain proper paid-partnership disclosure (#ad, #sponsored, or platform paid-partnership label mention) AND mention PULSE by Laurel Bath House?
Caption: """${(c.rawModash as any)?.postCaption ?? ""}""" URL: ${c.postUrl}
Return ONLY JSON: {"disclosureOk": true|false, "reason": "..."}`)));
    await step.run("save", () => db.update(creators).set({ disclosureOk: ai.disclosureOk, updatedAt: new Date() }).where(eq(creators.id, c.id)));
    if (ai.disclosureOk) {
      await step.run("completion-payout", () => db.insert(payouts).values({
        creatorId: c.id, half: "completion", amountUsd: Math.round((c.rateUsd ?? 0) / 2), status: "pending",
      }));
      // stage -> 'paid' happens only when David approves the payout in the human queue
    }
  });
