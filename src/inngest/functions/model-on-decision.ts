import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators, modelWeights } from "@/db/schema";
import { fitScore, updateWeights } from "@/lib/model";

export const modelOnDecision = inngest.createFunction(
  { id: "pulse-model-on-decision", concurrency: 1 }, // serialize weight updates
  { event: "decision.recorded" },
  async ({ event, step }) => {
    const { features, action } = event.data;
    await step.run("update-weights", async () => {
      const [w] = await db.select().from(modelWeights);
      const cur = (w?.weights as Record<string, number>) ?? {};
      const count = w?.decisionCount ?? 0;
      const next = updateWeights(cur, features, action === "reject" ? 0 : 1, count);
      await db.insert(modelWeights).values({ id: 1, weights: next, decisionCount: count + 1, updatedAt: new Date() })
        .onConflictDoUpdate({ target: modelWeights.id, set: { weights: next, decisionCount: count + 1, updatedAt: new Date() } });
    });
    await step.run("rescore-review-queue", async () => {
      const [w] = await db.select().from(modelWeights);
      const queue = await db.select().from(creators).where(eq(creators.stage, "review"));
      for (const c of queue)
        await db.update(creators).set({ fitScore: fitScore(c, (w!.weights as any)) }).where(eq(creators.id, c.id));
    });
  });
