import { serve } from "inngest/next";
import { inngest, functions } from "@/lib/inngest";
import { enrichOnSourced } from "@/inngest/functions/enrich-on-sourced";
import { outreachOnTiered } from "@/inngest/functions/outreach-on-tiered";
import { repliesWebhook } from "@/inngest/functions/replies-webhook";
import { onboardTally } from "@/inngest/functions/onboard-tally";
import { fulfillPoll } from "@/inngest/functions/fulfill-poll";
import { activationCheck } from "@/inngest/functions/activation-check";
import { complianceOnPosted } from "@/inngest/functions/compliance-on-posted";
import { modelOnDecision } from "@/inngest/functions/model-on-decision";

export const runtime = "nodejs";

// Public endpoint (allowlisted in middleware); signature-verified via
// INNGEST_SIGNING_KEY in production. Serves the original sync jobs plus the
// eight PULSE campaign functions.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ...functions,
    enrichOnSourced,
    outreachOnTiered,
    repliesWebhook,
    onboardTally,
    fulfillPoll,
    activationCheck,
    complianceOnPosted,
    modelOnDecision,
  ],
});
