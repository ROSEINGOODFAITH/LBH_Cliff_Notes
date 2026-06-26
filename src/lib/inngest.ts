import { Inngest } from "inngest";
import { syncReplies } from "@/lib/outreach";
import { syncAttributedOrders } from "@/lib/affiliates";
import { syncBrandMentions } from "@/lib/content";

/**
 * Inngest client + scheduled jobs. Keys (INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY)
 * are read from env automatically. Each job's underlying logic is also exposed as
 * a manual action, so the app works without Inngest configured.
 */
export const inngest = new Inngest({ id: "lbh-cliff-notes" });

export const syncGmailReplies = inngest.createFunction(
  { id: "sync-gmail-replies" },
  { cron: "*/10 * * * *" }, // every 10 minutes
  async ({ step }) => step.run("sync-replies", async () => syncReplies()),
);

export const syncShopifyOrders = inngest.createFunction(
  { id: "sync-shopify-orders" },
  { cron: "*/30 * * * *" }, // every 30 minutes
  async ({ step }) => step.run("sync-orders", async () => syncAttributedOrders()),
);

export const syncContentMentions = inngest.createFunction(
  { id: "sync-content-mentions" },
  { cron: "0 */6 * * *" }, // every 6 hours
  async ({ step }) => step.run("sync-mentions", async () => syncBrandMentions()),
);

export const functions = [syncGmailReplies, syncShopifyOrders, syncContentMentions];
