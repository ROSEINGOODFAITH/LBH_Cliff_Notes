import { eq, sql } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators } from "@/db/schema";
import { createGiftDraftOrder } from "@/lib/shopify";
import { claimGift, completeGift, failGift } from "@/lib/provisioning";

const normalizeHandle = (h: string | null | undefined) => (h ?? "").trim().replace(/^@+/, "").toLowerCase();

/**
 * Address-form submissions (Tally webhook → `tally/intake.submitted`).
 *
 * The form's "Would you want to?" selection routes the person:
 * - "Be removed from our list" → opt-out: marked Done/never contacted again
 *   (a suppression record is created even for unknowns).
 * - "Review 'Pulse' Now" + already Invited/Replied + address → ship now.
 * - Everything else (unknowns, earlier stages, "another scent", "future") →
 *   surface at "Your call" with address + choices attached; the owner decides,
 *   and approving ships immediately when an address is on file.
 * Nothing ships without either a prior invite acceptance or the owner's tap.
 */
export const onboardTally = inngest.createFunction(
  { id: "pulse-onboard-tally" },
  { event: "tally/intake.submitted" },
  async ({ event, step }) => {
    const { handle, email, igHandle, name, address1, city, province, zip, country, choices } = event.data;
    const norm = normalizeHandle(handle);
    const igNorm = normalizeHandle(igHandle);
    const cleanEmail = typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
    const choiceStr = typeof choices === "string" && choices.trim() ? choices.trim() : null;
    const optedOut = /remove/i.test(choiceStr ?? "");
    const wantsPulseNow = !choiceStr || /pulse/i.test(choiceStr);
    const shipping = address1
      ? { first_name: name ?? "", address1, city: city ?? "", province: province ?? "", zip: zip ?? "", country: country ?? "US" }
      : null;
    const submittedAt = new Date().toISOString();

    // Match by TikTok handle, then by email.
    let c = norm
      ? (await db.select().from(creators)
          .where(sql`lower(regexp_replace(${creators.handle}, '^@+', '')) = ${norm}`))[0]
      : undefined;
    if (!c && cleanEmail) {
      c = (await db.select().from(creators).where(eq(creators.email, cleanEmail)))[0];
    }

    // Opt-out: honor it everywhere, never contact again.
    if (optedOut) {
      if (!c) {
        if (!norm && !cleanEmail) return;
        await step.run("opt-out-record", () => db.insert(creators).values({
          handle: norm || cleanEmail!.split("@")[0],
          displayName: name ?? null,
          email: cleanEmail,
          source: "first_party",
          primaryPlatform: "tiktok",
          stage: "churned",
          sourceMetadata: { addressForm: true, optOut: true, formChoices: choiceStr, submittedAt },
        }));
        return;
      }
      const finished = ["posted", "paid"].includes(c.stage); // completed collabs keep their stage
      await step.run("opt-out", () => db.update(creators).set({
        ...(finished ? {} : { stage: "churned" }),
        sourceMetadata: { ...(c.sourceMetadata as any), optOut: true, formChoices: choiceStr, submittedAt },
        updatedAt: new Date(),
      }).where(eq(creators.id, c.id)));
      return;
    }

    // Unknown → create at "Your call" with everything they gave us.
    if (!c) {
      if (!norm && !cleanEmail) return; // nothing to identify them by
      await step.run("create-at-your-call", () => db.insert(creators).values({
        handle: norm || cleanEmail!.split("@")[0],
        displayName: name ?? null,
        email: cleanEmail,
        ...(igNorm ? { igHandle: igNorm } : {}),
        source: "first_party",
        primaryPlatform: "tiktok",
        stage: "review",
        sourceMetadata: { addressForm: true, ...(shipping ? { shipping } : {}), ...(choiceStr ? { formChoices: choiceStr } : {}), submittedAt },
      }));
      return;
    }

    // Duplicate submissions after shipping started: ignore.
    if (["onboarded", "shipped", "posted", "paid", "rejected", "churned"].includes(c.stage)) return;

    // A draft order already on file means the gift shipped once; a redelivered
    // webhook must not create a second free order. We check the draft-order id
    // specifically (not isProvisioned): a discountCode alone is expected here —
    // it's minted at invite time and legitimately precedes a later ship-now.
    if (c.shopifyDraftOrderId) return;

    // Already invited/replied, wants PULSE now, address given → ship now.
    if (["replied", "contacted"].includes(c.stage) && shipping && wantsPulseNow) {
      // Authoritative DB claim before the Shopify side effect — a redelivered
      // webhook or a race with outreach-on-tiered can't create a second order.
      const claim = await step.run("claim-gift", () => claimGift(c.id));
      if (!claim) return;
      try {
        const draft = await step.run("draft-order", () => createGiftDraftOrder({
          variantId: process.env.PULSE_SEEDING_VARIANT_ID!, shipping,
          creatorId: c.id, handle: c.handle, tier: c.tier,
        }));
        const draftOrderId = String(draft.draft_order.id);
        await step.run("save", () => db.update(creators).set({
          shopifyDraftOrderId: draftOrderId, stage: "onboarded",
          ...(igNorm ? { igHandle: igNorm } : {}),
          sourceMetadata: { ...(c.sourceMetadata as any), addressForm: true, shipping, ...(choiceStr ? { formChoices: choiceStr } : {}), submittedAt },
          updatedAt: new Date(),
        }).where(eq(creators.id, c.id)));
        await step.run("complete-claim", () => completeGift(claim.id, { draftOrderId }));
      } catch (err) {
        await step.run("fail-claim", () => failGift(claim.id, err));
        throw err;
      }
      return;
    }

    // Everything else known (earlier stages, "another scent", "future", or no
    // address) → attach what we learned and surface as a decision.
    await step.run("attach-and-surface", () => db.update(creators).set({
      stage: "review",
      ...(igNorm ? { igHandle: igNorm } : {}),
      ...(cleanEmail && !c.email ? { email: cleanEmail } : {}),
      ...(name && !c.displayName ? { displayName: name } : {}),
      sourceMetadata: { ...(c.sourceMetadata as any), addressForm: true, ...(shipping ? { shipping } : {}), ...(choiceStr ? { formChoices: choiceStr } : {}), submittedAt },
      updatedAt: new Date(),
    }).where(eq(creators.id, c.id)));
  });
