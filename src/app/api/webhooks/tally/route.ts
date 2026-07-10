import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";
import {
  flattenTallyFields,
  extractEmail,
  onboardTally,
  verifyTallySignature,
  TallyNotConfiguredError,
  type TallyWebhookPayload,
} from "@/lib/tally";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tally webhook — handles BOTH intake forms:
 *  1. PULSE seeding intake (TikTok handle and/or email + shipping address) →
 *     fires the `tally/intake.submitted` Inngest event (Shopify draft-order
 *     flow). Detected by the presence of a shipping address; matches the
 *     creator by TikTok handle OR email, and records the IG handle when given.
 *  2. IG creator onboarding (email + Instagram handle, no address) → the
 *     original first-party onboarding path.
 * Public (allowlisted in middleware) and verified by the Tally-Signature HMAC.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  try {
    if (!verifyTallySignature(rawBody, req.headers.get("tally-signature"))) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }
  } catch (e) {
    if (e instanceof TallyNotConfiguredError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 503 });
    }
    throw e;
  }

  let payload: TallyWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as TallyWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed JSON" }, { status: 400 });
  }

  const f = flattenTallyFields(payload);
  const email = extractEmail(payload);
  const igHandle = f["instagram handle"] ?? f["instagram"] ?? f["ig handle"];
  const tiktokHandle = f["tiktok handle"] ?? f["tiktok"] ?? f["handle"];
  const address1 = f["address"] ?? f["address line 1"] ?? f["street address"] ?? f["shipping address"];

  // ---- PULSE seeding intake: anything with a shipping address ----
  if (address1) {
    await inngest.send({
      name: "tally/intake.submitted",
      data: {
        handle: tiktokHandle,
        email,
        igHandle,
        name: f["name"] ?? f["full name"],
        address1,
        city: f["city"],
        province: f["state"] ?? f["province"],
        zip: f["zip"] ?? f["zip code"] ?? f["postal code"],
        country: f["country"] ?? "US",
      },
    });
    return NextResponse.json({ ok: true, flow: "pulse" });
  }

  // ---- IG creator onboarding (original flow) ----
  try {
    const { creator, created } = await onboardTally({
      email,
      igHandle,
      displayName: f["name"] ?? f["full name"] ?? null,
    });
    return NextResponse.json({ ok: true, flow: "onboard", created, creatorId: creator.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 422 });
  }
}
