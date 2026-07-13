import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators, modelWeights } from "@/db/schema";
import { claude, parseClaudeJson } from "@/lib/integrations";
import { fitScore } from "@/lib/model";

export const enrichOnSourced = inngest.createFunction(
  {
    id: "pulse-enrich-on-sourced",
    concurrency: 5,
  },
  { event: "creator.sourced" },
  async ({ event, step }) => {
    const c = (await db.select().from(creators).where(eq(creators.id, event.data.creatorId)))[0];
    if (!c || c.stage !== "sourced") return;
    // Build stats purely from the row's existing (imported) data.
    const stats = {
      followerCount: c.followerCount,
      engagementRate: c.engagementRate,
      avgViews: c.avgViews,
      fakeFollowerPct: c.fakeFollowerPct,
      geo: c.geo,
      niche: c.niche,
      email: c.email,
    };
    // Best-effort: a failed Claude call must not strand the creator at `sourced`.
    const profileJson = { handle: c.handle, ...stats };
    const ai = await step.run("claude-brand-fit", async () => {
      try {
        return parseClaudeJson(await claude(
          `You score TikTok creators for Laurel Bath House, a refined DTC fragrance brand launching PULSE.
Profile JSON: ${JSON.stringify(profileJson).slice(0, 6000)}
Return ONLY JSON: {"aestheticScore": 0-100 brand fit, "firstLine": "one specific, warm, non-generic opening line referencing their content"}`));
      } catch (e) {
        console.warn(`[pulse] claude scoring unavailable for @${c.handle}:`, String(e).slice(0, 400));
        return { aestheticScore: null, firstLine: "", __unavailable: String(e).slice(0, 300) };
      }
    });
    const [w] = await db.select().from(modelWeights);
    const merged = { ...c, ...stats, aestheticScore: ai.aestheticScore ?? null };
    await step.run("save", () => db.update(creators).set({
      ...stats,
      aestheticScore: ai.aestheticScore ?? null,
      fitScore: fitScore(merged, (w?.weights as any) ?? {}),
      sourceMetadata: { ...(c.sourceMetadata as any), firstLine: ai.firstLine },
      stage: "review", updatedAt: new Date(),
    }).where(eq(creators.id, c.id)));
  });
