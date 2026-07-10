import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Smartlead EMAIL_REPLY webhook → `smartlead/reply.received` Inngest event. */
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.SMARTLEAD_WEBHOOK_SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  if (body.event_type === "EMAIL_REPLY") {
    await inngest.send({ name: "smartlead/reply.received", data: {
      email: body.to_email ?? body.lead_email, replyBody: body.reply_message?.text ?? body.reply_body ?? "",
      campaignId: String(body.campaign_id),
    }});
  }
  return NextResponse.json({ ok: true });
}
