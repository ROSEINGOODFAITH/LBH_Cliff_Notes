import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { creators, campaigns, outreachThreads, messages, events } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { brandConfig } from "@/lib/brand";
import {
  generateOutreach,
  classifyReply,
  anthropicConfigured,
  type OutreachContext,
} from "@/lib/anthropic";
import { sendEmail, listRecentMessages, getMessage, gmailConfigured } from "@/lib/gmail";

export type ThreadRow = typeof outreachThreads.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
type InterestLabel = (typeof outreachThreads.aiInterestLabel.enumValues)[number];
type CampaignObjective = (typeof campaigns.objective.enumValues)[number];

export interface ActionResult {
  ok: boolean;
  message: string;
  threadId?: string;
}

/* ------------------------------- Campaigns --------------------------------- */
export async function listCampaigns(): Promise<CampaignRow[]> {
  return db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(100);
}

export async function createCampaign(input: {
  name: string;
  objective: CampaignObjective;
  productSkus?: string[];
}): Promise<CampaignRow> {
  const [row] = await db
    .insert(campaigns)
    .values({ name: input.name, objective: input.objective, productSkus: input.productSkus ?? null, status: "active" })
    .returning();
  return row;
}

/* --------------------------------- Drafts ---------------------------------- */
async function ensureThread(creatorId: string, campaignId: string | null): Promise<ThreadRow> {
  const cond = campaignId
    ? and(eq(outreachThreads.creatorId, creatorId), eq(outreachThreads.campaignId, campaignId))
    : and(eq(outreachThreads.creatorId, creatorId), isNull(outreachThreads.campaignId));
  const existing = await db.select().from(outreachThreads).where(cond).limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db
    .insert(outreachThreads)
    .values({ creatorId, campaignId: campaignId ?? null, channel: "email", status: "draft" })
    .returning();
  return row;
}

async function latestUnsentDraft(threadId: string): Promise<MessageRow | undefined> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.threadId, threadId), eq(messages.direction, "outbound"), isNull(messages.sentAt)))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return rows[0];
}

export async function createOrRegenerateDraft(
  creatorId: string,
  campaignId: string | null,
  followUp = false,
): Promise<ActionResult> {
  const c = (await db.select().from(creators).where(eq(creators.id, creatorId)).limit(1))[0];
  if (!c) return { ok: false, message: "Creator not found." };
  if (!anthropicConfigured())
    return { ok: false, message: "Anthropic isn't configured — add ANTHROPIC_API_KEY to generate drafts." };

  let campaign: CampaignRow | null = null;
  if (campaignId) campaign = (await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1))[0] ?? null;

  const thread = await ensureThread(creatorId, campaignId);
  const ctx: OutreachContext = {
    creator: {
      handle: c.handle,
      displayName: c.displayName,
      platform: c.primaryPlatform,
      followerCount: c.followerCount,
      nicheTags: c.nicheTags,
      notes: followUp
        ? "This is a brief, polite follow-up to a previous unanswered email; keep it short and add a touch of new value."
        : c.notes,
    },
    campaign: campaign
      ? { name: campaign.name, objective: campaign.objective, productSkus: campaign.productSkus }
      : null,
  };

  let draft;
  try {
    draft = await generateOutreach(ctx);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Generation failed." };
  }

  if (followUp) {
    await db.insert(messages).values({ threadId: thread.id, direction: "outbound", body: draft.body, aiGenerated: true });
  } else {
    const existing = await latestUnsentDraft(thread.id);
    if (existing) await db.update(messages).set({ body: draft.body, aiGenerated: true }).where(eq(messages.id, existing.id));
    else await db.insert(messages).values({ threadId: thread.id, direction: "outbound", body: draft.body, aiGenerated: true });
    await db.update(outreachThreads).set({ subject: draft.subject, status: "draft" }).where(eq(outreachThreads.id, thread.id));
  }
  return { ok: true, message: `Draft ready for @${c.handle}.`, threadId: thread.id };
}

export async function updateDraftBody(threadId: string, body: string): Promise<ActionResult> {
  const draft = await latestUnsentDraft(threadId);
  if (!draft) return { ok: false, message: "No draft to edit." };
  await db.update(messages).set({ body, aiGenerated: false }).where(eq(messages.id, draft.id));
  return { ok: true, message: "Draft updated.", threadId };
}

export async function approveAndSend(threadId: string): Promise<ActionResult> {
  const thread = (await db.select().from(outreachThreads).where(eq(outreachThreads.id, threadId)).limit(1))[0];
  if (!thread) return { ok: false, message: "Thread not found." };
  const c = (await db.select().from(creators).where(eq(creators.id, thread.creatorId)).limit(1))[0];
  if (!c?.email) return { ok: false, message: "Creator has no email — add one before sending." };
  if (!gmailConfigured()) return { ok: false, message: "Gmail isn't configured — add GMAIL_* env vars to send." };
  const draft = await latestUnsentDraft(threadId);
  if (!draft) return { ok: false, message: "No draft to send." };

  const subject = thread.gmailThreadId
    ? `Re: ${thread.subject ?? ""}`.trim()
    : thread.subject ?? `Hello from ${brandConfig.brandName}`;
  try {
    const sent = await sendEmail({
      to: c.email,
      subject,
      body: draft.body,
      threadId: thread.gmailThreadId ?? undefined,
    });
    await db.update(messages).set({ sentAt: new Date(), gmailMessageId: sent.id }).where(eq(messages.id, draft.id));
    await db
      .update(outreachThreads)
      .set({ gmailThreadId: sent.threadId, status: "awaiting_reply", lastMessageAt: new Date() })
      .where(eq(outreachThreads.id, threadId));
    if (c.status === "prospect") await db.update(creators).set({ status: "contacted" }).where(eq(creators.id, c.id));
    await db.insert(events).values({ creatorId: c.id, type: "outreach.sent", payload: { threadId } });
    return { ok: true, message: `Sent to @${c.handle}.`, threadId };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Send failed." };
  }
}

/* ------------------------------ Reply sync --------------------------------- */
export interface SyncResult {
  ok: boolean;
  message: string;
  processed: number;
  classified: number;
}

export async function syncReplies(): Promise<SyncResult> {
  if (!gmailConfigured())
    return { ok: false, message: "Gmail isn't configured — add GMAIL_* env vars to sync replies.", processed: 0, classified: 0 };

  const sentThreads = await db
    .select()
    .from(outreachThreads)
    .where(sql`${outreachThreads.gmailThreadId} is not null`);
  const byGmailThread = new Map<string, ThreadRow>();
  for (const t of sentThreads) if (t.gmailThreadId) byGmailThread.set(t.gmailThreadId, t);
  if (byGmailThread.size === 0) return { ok: true, message: "No sent threads to sync yet.", processed: 0, classified: 0 };

  const sender = (getEnv().GMAIL_SENDER ?? "").toLowerCase();
  let processed = 0;
  let classified = 0;

  const recent = await listRecentMessages("newer_than:21d", 80);
  for (const ref of recent) {
    const thread = byGmailThread.get(ref.threadId);
    if (!thread) continue;
    const dup = await db.select({ id: messages.id }).from(messages).where(eq(messages.gmailMessageId, ref.id)).limit(1);
    if (dup[0]) continue;

    const full = await getMessage(ref.id);
    if (sender && full.from.toLowerCase().includes(sender)) continue; // our own outbound

    const text = full.body || full.snippet;
    let classificationJson: unknown = null;
    let label: InterestLabel | null = null;
    if (anthropicConfigured() && text) {
      try {
        const cls = await classifyReply(text);
        classificationJson = cls;
        label = cls.label;
        classified++;
      } catch {
        /* leave unclassified */
      }
    }

    await db.insert(messages).values({
      threadId: thread.id,
      direction: "inbound",
      body: text,
      sentAt: full.date ? new Date(full.date) : null,
      gmailMessageId: ref.id,
      classificationJson,
    });
    await db
      .update(outreachThreads)
      .set({ status: "replied", aiInterestLabel: label, lastMessageAt: new Date() })
      .where(eq(outreachThreads.id, thread.id));
    await db
      .update(creators)
      .set({ status: "replied" })
      .where(and(eq(creators.id, thread.creatorId), eq(creators.status, "contacted")));
    await db.insert(events).values({ creatorId: thread.creatorId, type: "reply.received", payload: { threadId: thread.id, label } });
    processed++;
  }

  return {
    ok: true,
    message: `Synced ${processed} new repl${processed === 1 ? "y" : "ies"}${classified ? `, ${classified} classified` : ""}.`,
    processed,
    classified,
  };
}

/* ------------------------------- Inbox views ------------------------------- */
export const LABEL_PRIORITY: Record<string, number> = {
  interested: 0,
  needs_follow_up: 1,
  maybe: 2,
  ooo: 3,
  not_interested: 4,
};

export interface InboxItem {
  thread: ThreadRow;
  creatorHandle: string;
  creatorEmail: string | null;
  latest: MessageRow | null;
  latestInbound: MessageRow | null;
}

export async function listInbox(): Promise<InboxItem[]> {
  const rows = await db
    .select({ thread: outreachThreads, handle: creators.handle, email: creators.email })
    .from(outreachThreads)
    .innerJoin(creators, eq(outreachThreads.creatorId, creators.id))
    .where(sql`${outreachThreads.status} <> 'draft'`)
    .orderBy(
      sql`case ${outreachThreads.aiInterestLabel} when 'interested' then 0 when 'needs_follow_up' then 1 when 'maybe' then 2 when 'ooo' then 3 when 'not_interested' then 4 else 5 end`,
      desc(outreachThreads.lastMessageAt),
    )
    .limit(100);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.thread.id);
  const msgs = await db.select().from(messages).where(inArray(messages.threadId, ids)).orderBy(desc(messages.createdAt));
  const latest = new Map<string, MessageRow>();
  const latestInbound = new Map<string, MessageRow>();
  for (const m of msgs) {
    if (!latest.has(m.threadId)) latest.set(m.threadId, m);
    if (m.direction === "inbound" && !latestInbound.has(m.threadId)) latestInbound.set(m.threadId, m);
  }
  return rows.map((r) => ({
    thread: r.thread,
    creatorHandle: r.handle,
    creatorEmail: r.email,
    latest: latest.get(r.thread.id) ?? null,
    latestInbound: latestInbound.get(r.thread.id) ?? null,
  }));
}

export interface DraftItem {
  thread: ThreadRow;
  creatorHandle: string;
  creatorEmail: string | null;
  draft: MessageRow | null;
}

export async function listDrafts(): Promise<DraftItem[]> {
  const rows = await db
    .select({ thread: outreachThreads, handle: creators.handle, email: creators.email })
    .from(outreachThreads)
    .innerJoin(creators, eq(outreachThreads.creatorId, creators.id))
    .where(eq(outreachThreads.status, "draft"))
    .orderBy(desc(outreachThreads.updatedAt))
    .limit(100);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.thread.id);
  const msgs = await db
    .select()
    .from(messages)
    .where(and(inArray(messages.threadId, ids), eq(messages.direction, "outbound"), isNull(messages.sentAt)))
    .orderBy(desc(messages.createdAt));
  const latest = new Map<string, MessageRow>();
  for (const m of msgs) if (!latest.has(m.threadId)) latest.set(m.threadId, m);
  return rows.map((r) => ({
    thread: r.thread,
    creatorHandle: r.handle,
    creatorEmail: r.email,
    draft: latest.get(r.thread.id) ?? null,
  }));
}
