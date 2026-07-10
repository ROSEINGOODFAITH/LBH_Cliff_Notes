import { eq, sql } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators } from "@/db/schema";
import { shopifyDraftOrder } from "@/lib/integrations";

const normalizeHandle = (h: string | null | undefined) => (h ?? "").trim().replace(/^@+/, "").toLowerCase();

export const onboardTally = inngest.createFunction(
  { id: "pulse-onboard-tally" },
  { event: "tally/intake.submitted" },
  async ({ event, step }) => {
    const { handle, email, igHandle, name, address1, city, province, zip, country } = event.data;
    // Match by TikTok handle when present, otherwise by email (form works with
    // just an email + shipping address).
    const norm = normalizeHandle(handle);
    let c = norm
      ? (await db.select().from(creators)
          .where(sql`lower(regexp_replace(${creators.handle}, '^@+', '')) = ${norm}`))[0]
      : undefined;
    if (!c && email) {
      c = (await db.select().from(creators).where(eq(creators.email, email)))[0];
    }
    if (!c || !["replied", "contacted"].includes(c.stage)) return;
    const draft = await step.run("draft-order", () => shopifyDraftOrder(
      process.env.PULSE_SEEDING_VARIANT_ID!,
      { first_name: name, address1, city, province, zip, country: country ?? "US" },
      `PULSE seeding — @${c.handle} — Tier ${c.tier}`));
    const igNorm = normalizeHandle(igHandle);
    await step.run("save", () => db.update(creators).set({
      shopifyDraftOrderId: String((draft as any).draft_order.id), stage: "onboarded",
      ...(igNorm ? { igHandle: igNorm } : {}), // capture IG alongside TikTok when given
      updatedAt: new Date(),
    }).where(eq(creators.id, c.id)));
  });
