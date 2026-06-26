import { serve } from "inngest/next";
import { inngest, functions } from "@/lib/inngest";

export const runtime = "nodejs";

// Public endpoint (allowlisted in middleware). Inngest invokes the scheduled
// reply-sync here; signature-verified via INNGEST_SIGNING_KEY in production.
export const { GET, POST, PUT } = serve({ client: inngest, functions });
