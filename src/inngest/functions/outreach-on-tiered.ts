import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators, outreachEvents } from "@/db/schema";
import { smartleadPushLead, shopifyCreateDiscount } from "@/lib/integrations";

export const outreachOnTiered = inngest.createFunction(
  { id: "pulse-outreach-on-tiered" },
  { event: "creator.tiered" },
  async ({ event, step }) => {
    const c = (await db.select().from(creators).where(eq(creators.id, event.data.creatorId)))[0];
    if (!c || !["A", "B"].includes(c.tier ?? "") || !c.email) return;
    const code = "PULSE-" + c.handle.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
    const disc = await step.run("shopify-code", () => shopifyCreateDiscount(code));
    const campaignId = c.tier === "A" ? process.env.SMARTLEAD_CAMPAIGN_TIER_A! : process.env.SMARTLEAD_CAMPAIGN_TIER_B!;
    const res = await step.run("smartlead-push", () => smartleadPushLead(campaignId, {
      email: c.email!, first_name: c.handle,
      custom_fields: { handle: c.handle, first_line: (c.rawModash as any)?.firstLine ?? "", code },
    }));
    await step.run("save", async () => {
      await db.update(creators).set({ discountCode: code, stage: "contacted", updatedAt: new Date() }).where(eq(creators.id, c.id));
      await db.insert(outreachEvents).values({ creatorId: c.id, type: "pushed", payload: { smartlead: res, shopifyDiscount: disc } as any });
    });
  });
