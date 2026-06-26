import { Inngest } from "inngest";
import { syncReplies } from "@/lib/outreach";

/**
 * Inngest client + scheduled reply sync. Keys (INNGEST_EVENT_KEY /
 * INNGEST_SIGNING_KEY) are read from env automatically. The same syncReplies()
 * logic is exposed as a manual action, so reply sync also works without Inngest.
 */
export const inngest = new Inngest({ id: "lbh-cliff-notes" });

export const syncGmailReplies = inngest.createFunction(
  { id: "sync-gmail-replies" },
  { cron: "*/10 * * * *" }, // every 10 minutes
  async ({ step }) => {
    return step.run("sync-replies", async () => syncReplies());
  },
);

export const functions = [syncGmailReplies];
