import { Inngest } from "inngest";
import { syncReplies } from "@/lib/outreach";
import { syncAttributedOrders } from "@/lib/affiliates";
import { syncBrandMentions } from "@/lib/content";
import { executeRun, sweepDueRuns } from "@/lib/pulse-flow-runner";

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

/**
 * Sweep due PULSE flow runs. Only runs already in `scheduled` (i.e. approved by
 * an operator) with a due `scheduledFor` are executed; the runner is idempotent
 * and applies the Gmail-identity gate before any external send.
 */
export const sweepFlowRuns = inngest.createFunction(
  { id: "sweep-flow-runs" },
  { cron: "*/5 * * * *" }, // every 5 minutes
  async ({ step }) => step.run("sweep-due-runs", async () => sweepDueRuns()),
);

/** Execute a single scheduled run immediately when the app enqueues it. */
export const runFlowStep = inngest.createFunction(
  { id: "run-flow-step" },
  { event: "pulse/flow.run.scheduled" },
  async ({ event, step }) =>
    step.run("execute-run", async () => executeRun(event.data.runId as string)),
);

export const functions = [
  syncGmailReplies,
  syncShopifyOrders,
  syncContentMentions,
  sweepFlowRuns,
  runFlowStep,
];
