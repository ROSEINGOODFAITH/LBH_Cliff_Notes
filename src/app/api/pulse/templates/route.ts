import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creators } from "@/db/schema";
import { TEMPLATES, TEMPLATE_KEYS, renderTemplate, PULSE_BRIEF, type TemplateVars } from "@/lib/pulse-templates";
import { pulseFit } from "@/lib/pulse-fit";
import { getEnv } from "@/lib/env";

/**
 * The approved PULSE message templates. With `?creatorId=`, each template is
 * rendered with that creator's angle so the operator can copy/edit a ready
 * draft. This NEVER sends — drafting/queuing only (guardrail §9).
 */
export async function GET(req: NextRequest) {
  const creatorId = req.nextUrl.searchParams.get("creatorId");
  let vars: TemplateVars | null = null;

  if (creatorId) {
    const c = (await db.select().from(creators).where(eq(creators.id, creatorId)).limit(1))[0];
    if (!c) return NextResponse.json({ error: "creator not found" }, { status: 404 });
    const fit = pulseFit(c);
    let formUrl: string | null = null;
    let briefUrl: string | null = null;
    try {
      const env = getEnv();
      formUrl = env.TALLY_FORM_URL ?? null;
      briefUrl = env.CREATIVE_BRIEF_URL ?? null;
    } catch {
      /* env not fully configured — fall back to placeholders */
    }
    vars = {
      handle: c.handle,
      firstName: c.displayName,
      angle: fit.angle,
      ring: (c.ring as TemplateVars["ring"]) ?? null,
      trackingNumber: c.trackingNumber,
      discountCode: c.discountCode,
      rateUsd: c.rateUsd,
      formUrl,
      briefUrl,
    };
  }

  const templates = TEMPLATE_KEYS.map((k) => {
    const t = TEMPLATES[k];
    const rendered = vars ? renderTemplate(k, vars) : { subject: t.subject, body: t.body };
    return { key: t.key, label: t.label, when: t.when, approvalRequired: t.approvalRequired, ...rendered };
  });

  return NextResponse.json({ brief: PULSE_BRIEF, templates });
}
