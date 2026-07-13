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
  const keys = Object.keys(f);
  const findKey = (re: RegExp, exclude?: RegExp) => keys.find(k => re.test(k) && !(exclude && exclude.test(k)));
  // Fuzzy label matching — the live form says "Your TikTok Handle" etc.
  const tiktokKey = findKey(/tiktok/) ?? findKey(/^@?handle$|social.*handle|primary.*handle/);
  const tiktokHandle = tiktokKey ? f[tiktokKey] : null;
  const igKey = findKey(/instagram|(^|\s)ig\b/);
  const igHandle = igKey ? f[igKey] : null;
  // Fuzzy address detection — form labels vary ("Address", "Street address",
  // "Mailing address"…); never mistake "Email address" or a handle for it.
  const addressKey = findKey(/address|street/, /e-?mail|instagram|tiktok|handle/);
  const address1 = addressKey ? f[addressKey] : null;

  // ---- PULSE intake: anything with a shipping address OR a TikTok handle ----
  // (unknown submitters become a "Your call" decision, never raw "Found")
  if (address1 || tiktokHandle) {
    await inngest.send({
      name: "tally/intake.submitted",
      data: {
        handle: tiktokHandle,
        email,
        igHandle,
        name: f[findKey(/^(full )?name/) ?? ""] ?? f["name"] ?? null,
        address1,
        city: f[findKey(/city|town/) ?? ""] ?? null,
        province: f[findKey(/state|province|region/) ?? ""] ?? null,
        zip: f[findKey(/zip|postal/) ?? ""] ?? null,
        country: f[findKey(/country/) ?? ""] ?? "US",
        choices: f[findKey(/would you want|want to|interested/) ?? ""] ?? null,
        scentPreference: f[findKey(/scent/) ?? ""] ?? null,
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
