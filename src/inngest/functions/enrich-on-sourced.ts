import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators, modelWeights } from "@/db/schema";
import { modashReport, claude, parseClaudeJson } from "@/lib/integrations";
import { fitScore } from "@/lib/model";

export const enrichOnSourced = inngest.createFunction(
  { id: "pulse-enrich-on-sourced", concurrency: 5 },
  { event: "creator.sourced" },
  async ({ event, step }) => {
    const c = (await db.select().from(creators).where(eq(creators.id, event.data.creatorId)))[0];
    if (!c || c.stage !== "sourced") return;
    const report = await step.run("modash-report", () => modashReport(c.modashId!));
    const ai = await step.run("claude-brand-fit", async () => parseClaudeJson(await claude(
      `You score TikTok creators for Laurel Bath House, a refined DTC fragrance brand launching PULSE.
Profile JSON: ${JSON.stringify(report).slice(0, 6000)}
Return ONLY JSON: {"aestheticScore": 0-100 brand fit, "firstLine": "one specific, warm, non-generic opening line referencing their content"}`)));
    const [w] = await db.select().from(modelWeights);
    const merged = { ...c, aestheticScore: ai.aestheticScore };
    await step.run("save", () => db.update(creators).set({
      aestheticScore: ai.aestheticScore,
      fitScore: fitScore(merged, (w?.weights as any) ?? {}),
      rawModash: { ...(c.rawModash as any), report, firstLine: ai.firstLine },
      stage: "review", updatedAt: new Date(),
    }).where(eq(creators.id, c.id)));
  });
