import { NextResponse } from "next/server";
import {
  flattenTallyFields,
  onboardTally,
  verifyTallySignature,
  TallyNotConfiguredError,
  type TallyWebhookPayload,
} from "@/lib/tally";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tally onboarding webhook. Public (allowlisted in middleware under
 * /api/webhooks) and verified by the `Tally-Signature` HMAC. Parses the
 * submission and onboards a creator.
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

  const eventData = {
    email: f["email"],
    igHandle: f["instagram handle"],
    displayName: f["name"] ?? f["full name"] ?? null,
  };

  try {
    const { creator, created } = await onboardTally(eventData);
    return NextResponse.json({ ok: true, created, creatorId: creator.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 422 });
  }
}
