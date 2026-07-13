import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  numeric,
  real,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* ===========================================================================
 * Enums
 * ========================================================================= */
export const platformEnum = pgEnum("platform", ["instagram", "tiktok", "youtube"]);
export const creatorSourceEnum = pgEnum("creator_source", [
  // "modash" is retained ONLY so historical rows imported before the provider
  // migration remain readable — Postgres cannot drop an enum value in use. No
  // code path writes it anymore. New external data uses "csv".
  "modash",
  "csv",
  "first_party",
  "manual",
  "competitor_mention",
]);
export const creatorStatusEnum = pgEnum("creator_status", [
  "prospect",
  "contacted",
  "replied",
  "negotiating",
  "active",
  "declined",
  "dormant",
]);
/** PULSE campaign pipeline stage (module-owned; coexists with `status`). */
export const creatorStageEnum = pgEnum("creator_stage", [
  "sourced",
  "review",
  "contacted",
  "replied",
  "onboarded",
  "shipped",
  "posted",
  "paid",
  "rejected",
  "churned",
]);
export const campaignObjectiveEnum = pgEnum("campaign_objective", ["gifting", "affiliate", "paid"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "active", "paused", "completed"]);
export const outreachChannelEnum = pgEnum("outreach_channel", ["email"]);
export const outreachStatusEnum = pgEnum("outreach_status", [
  "draft",
  "queued",
  "sent",
  "awaiting_reply",
  "replied",
  "closed",
]);
export const aiInterestLabelEnum = pgEnum("ai_interest_label", [
  "interested",
  "maybe",
  "not_interested",
  "needs_follow_up",
  "ooo",
]);
export const messageDirectionEnum = pgEnum("message_direction", ["outbound", "inbound"]);
export const affiliateStatusEnum = pgEnum("affiliate_status", ["pending", "active", "paused", "revoked"]);
export const postTypeEnum = pgEnum("post_type", ["story", "post", "reel", "tiktok", "short"]);

/* ===========================================================================
 * creators — master record (one row per creator, deduped across sources)
 * ========================================================================= */
export const creators = pgTable(
  "creators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: text("handle").notNull(),
    displayName: text("display_name"),
    email: text("email"),
    igHandle: text("ig_handle"), // nullable — self-reported IG handle (Tally onboarding)
    primaryPlatform: platformEnum("primary_platform"),
    followerCount: integer("follower_count"),
    engagementRate: real("engagement_rate"), // 0..1 (e.g. 0.034 = 3.4%)
    nicheTags: text("niche_tags").array(),
    audienceGeo: jsonb("audience_geo"), // { US: 0.62, GB: 0.1, ... }
    audienceAge: jsonb("audience_age"), // { "18-24": 0.41, ... }
    avatarUrl: text("avatar_url"),
    source: creatorSourceEnum("source").notNull().default("manual"),
    /** Stable external identifier from the source that first supplied this row
     * (e.g. a CSV export's account id). Provider-neutral; deduped via unique idx. */
    externalId: text("external_id"),
    lastEnrichedAt: timestamp("last_enriched_at", { withTimezone: true }),
    /**
     * DEPRECATED legacy CRM status. `stage` is the sole authoritative lifecycle
     * field (see lib/lifecycle.ts). Retained as a nullable, non-authoritative
     * column for one release so a rollback can still read historical values;
     * physical removal of the column + `creator_status` enum is a documented
     * follow-up, blocked only by `campaign_creators.stage` (mistyped with the
     * same enum). No code reads or writes this for lifecycle decisions.
     */
    status: creatorStatusEnum("status"),
    notes: text("notes"),
    // ---- PULSE campaign module (sourcing → HITL tiering → outreach → fulfillment) ----
    avgViews: integer("avg_views"),
    fakeFollowerPct: real("fake_follower_pct"), // 0..100
    geo: text("geo"),
    niche: text("niche"), // single primary niche (PULSE); `nicheTags` remains the multi-tag field
    aestheticScore: integer("aesthetic_score"), // 0..100, Claude brand-fit
    fitScore: integer("fit_score").default(50),
    /** PULSE explainable fit rubric (0..100) + component breakdown; see lib/pulse-fit.ts. */
    pulseFit: jsonb("pulse_fit"), // { score, components, spamRisk, tags, rationale, missing }
    /** PULSE operational ring: signal | editorial | advocate (see lib/pulse-rings.ts). */
    ring: text("ring"),
    /**
     * Relationship strength: COLD | WARM | FAM (see lib/relationship.ts). Nullable
     * so existing rows default to unknown (least-risky backfill — never rewrites
     * stage). Orthogonal to both `stage` and `ring`.
     */
    relationshipTier: text("relationship_tier"),
    stage: creatorStageEnum("stage").notNull().default("sourced"),
    tier: text("tier"), // A | B
    discountCode: text("discount_code"),
    rateUsd: integer("rate_usd"),
    shopifyDraftOrderId: text("shopify_draft_order_id"),
    trackingNumber: text("tracking_number"),
    postUrl: text("post_url"),
    postVerifiedAt: timestamp("post_verified_at", { withTimezone: true }),
    disclosureOk: boolean("disclosure_ok"),
    /** Provider-neutral metadata blob: raw enrichment fields, shipping/consent
     * captured during onboarding, and CSV import profiles (under `import`). */
    sourceMetadata: jsonb("source_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    statusIdx: index("creators_status_idx").on(t.status),
    sourceIdx: index("creators_source_idx").on(t.source),
    handleIdx: index("creators_handle_idx").on(t.handle),
    externalIdUnique: uniqueIndex("creators_external_id_unique").on(t.externalId),
    stageIdx: index("creators_stage_idx").on(t.stage),
    fitIdx: index("creators_fit_idx").on(t.fitScore),
    ringIdx: index("creators_ring_idx").on(t.ring),
    relationshipTierIdx: index("creators_relationship_tier_idx").on(t.relationshipTier),
    discountCodeUnique: uniqueIndex("creators_discount_code_unique").on(t.discountCode),
  }),
);

/* ===========================================================================
 * flow_steps — persisted PULSE action-flow configuration (single active flow).
 * Orchestrates the actions AROUND the canonical lifecycle; it never owns the
 * stage. One row per step; `position` gives execution order and `next_step_key`
 * threads the sequence. See lib/pulse-flow.ts for validation/semantics.
 * ========================================================================= */
export const flowSteps = pgTable(
  "flow_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    actionType: text("action_type").notNull(),
    /** Canonical stage this action orbits (nullable = internal/no stage). */
    stage: text("stage"),
    /** Applicable relationship tiers (COLD/WARM/FAM). */
    tiers: text("tiers").array().notNull(),
    templateKey: text("template_key"),
    delayMinutes: integer("delay_minutes"),
    approvalRequired: boolean("approval_required").notNull().default(true),
    autoSendsExternal: boolean("auto_sends_external").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    nextStepKey: text("next_step_key"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    keyUnique: uniqueIndex("flow_steps_key_unique").on(t.key),
    positionIdx: index("flow_steps_position_idx").on(t.position),
  }),
);

/* ===========================================================================
 * flow_runs — per-creator progress through a flow step. `unique(creator, step)`
 * is the idempotency key: a scheduled/completed run is never duplicated. Status
 * tracks the operator-facing lifecycle of one action (waiting/approval/etc.).
 * ========================================================================= */
export const flowRuns = pgTable(
  "flow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    status: text("status").notNull().default("pending"),
    threadId: uuid("thread_id").references(() => outreachThreads.id, { onDelete: "set null" }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    creatorStepUnique: uniqueIndex("flow_runs_creator_step_unique").on(t.creatorId, t.stepKey),
    creatorIdx: index("flow_runs_creator_idx").on(t.creatorId),
    statusIdx: index("flow_runs_status_idx").on(t.status),
  }),
);

export const flowRunsRelations = relations(flowRuns, ({ one }) => ({
  creator: one(creators, { fields: [flowRuns.creatorId], references: [creators.id] }),
  thread: one(outreachThreads, { fields: [flowRuns.threadId], references: [outreachThreads.id] }),
}));

/* ===========================================================================
 * creator_socials — per-platform handles for a creator
 * ========================================================================= */
export const creatorSocials = pgTable(
  "creator_socials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    handle: text("handle").notNull(),
    url: text("url"),
    followers: integer("followers"),
    lastSynced: timestamp("last_synced", { withTimezone: true }),
  },
  (t) => ({
    creatorPlatformUnique: uniqueIndex("creator_socials_creator_platform_unique").on(
      t.creatorId,
      t.platform,
    ),
  }),
);

/* ===========================================================================
 * campaigns
 * ========================================================================= */
export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  objective: campaignObjectiveEnum("objective").notNull().default("gifting"),
  productSkus: text("product_skus").array(),
  status: campaignStatusEnum("status").notNull().default("draft"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/* ===========================================================================
 * campaign_creators — join (which creators are in which campaign + their stage)
 * ========================================================================= */
export const campaignCreators = pgTable(
  "campaign_creators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    stage: creatorStatusEnum("stage").notNull().default("prospect"),
    owner: text("owner"), // team member email
    lastTouch: timestamp("last_touch", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignCreatorUnique: uniqueIndex("campaign_creators_unique").on(t.campaignId, t.creatorId),
  }),
);

/* ===========================================================================
 * outreach_threads — one conversation per creator (per campaign) over email
 * ========================================================================= */
export const outreachThreads = pgTable(
  "outreach_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    channel: outreachChannelEnum("channel").notNull().default("email"),
    subject: text("subject"),
    status: outreachStatusEnum("status").notNull().default("draft"),
    aiInterestLabel: aiInterestLabelEnum("ai_interest_label"),
    gmailThreadId: text("gmail_thread_id"), // for reply-sync matching (P2)
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    creatorIdx: index("outreach_threads_creator_idx").on(t.creatorId),
    labelIdx: index("outreach_threads_label_idx").on(t.aiInterestLabel),
    gmailThreadUnique: uniqueIndex("outreach_threads_gmail_thread_unique").on(t.gmailThreadId),
  }),
);

/* ===========================================================================
 * messages — every inbound/outbound message in a thread
 * ========================================================================= */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => outreachThreads.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    body: text("body").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    classificationJson: jsonb("classification_json"),
    gmailMessageId: text("gmail_message_id"), // idempotent reply-sync key (P2)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    threadIdx: index("messages_thread_idx").on(t.threadId),
    gmailMessageUnique: uniqueIndex("messages_gmail_message_unique").on(t.gmailMessageId),
  }),
);

/* ===========================================================================
 * affiliates — one per creator; owns the Shopify discount code
 * ========================================================================= */
export const affiliates = pgTable(
  "affiliates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    discountCode: text("discount_code").notNull(),
    affiliateLink: text("affiliate_link"),
    commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }),
    shopifyPriceRuleId: text("shopify_price_rule_id"),
    shopifyDiscountId: text("shopify_discount_id"),
    status: affiliateStatusEnum("status").notNull().default("pending"),
    signedUpAt: timestamp("signed_up_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    creatorUnique: uniqueIndex("affiliates_creator_unique").on(t.creatorId),
    discountCodeUnique: uniqueIndex("affiliates_discount_code_unique").on(t.discountCode),
  }),
);

/* ===========================================================================
 * orders_attributed — Shopify orders attributed to an affiliate code (idempotent)
 * ========================================================================= */
export const ordersAttributed = pgTable(
  "orders_attributed",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopifyOrderId: text("shopify_order_id").notNull(),
    affiliateId: uuid("affiliate_id").references(() => affiliates.id, { onDelete: "set null" }),
    discountCode: text("discount_code"),
    subtotalCents: integer("subtotal_cents"),
    currency: text("currency").notNull().default("USD"),
    orderDate: timestamp("order_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopifyOrderUnique: uniqueIndex("orders_attributed_shopify_order_unique").on(t.shopifyOrderId),
    affiliateIdx: index("orders_attributed_affiliate_idx").on(t.affiliateId),
  }),
);

/* ===========================================================================
 * content_mentions — brand-mentioning posts by tracked creators (idempotent)
 * ========================================================================= */
export const contentMentions = pgTable(
  "content_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    postUrl: text("post_url").notNull(),
    postType: postTypeEnum("post_type"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    caption: text("caption"),
    mediaUrl: text("media_url"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    metricsJson: jsonb("metrics_json"), // { likes, comments, views, ... }
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    postUrlUnique: uniqueIndex("content_mentions_post_url_unique").on(t.postUrl),
    creatorIdx: index("content_mentions_creator_idx").on(t.creatorId),
  }),
);

/* ===========================================================================
 * events — generic funnel activity log
 * ========================================================================= */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id").references(() => creators.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeIdx: index("events_type_idx").on(t.type),
    creatorIdx: index("events_creator_idx").on(t.creatorId),
  }),
);

/* ===========================================================================
 * Relations
 * ========================================================================= */
export const creatorsRelations = relations(creators, ({ many }) => ({
  socials: many(creatorSocials),
  campaignLinks: many(campaignCreators),
  threads: many(outreachThreads),
  affiliate: many(affiliates),
  mentions: many(contentMentions),
  events: many(events),
}));

export const creatorSocialsRelations = relations(creatorSocials, ({ one }) => ({
  creator: one(creators, { fields: [creatorSocials.creatorId], references: [creators.id] }),
}));

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  creatorLinks: many(campaignCreators),
  threads: many(outreachThreads),
}));

export const campaignCreatorsRelations = relations(campaignCreators, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignCreators.campaignId], references: [campaigns.id] }),
  creator: one(creators, { fields: [campaignCreators.creatorId], references: [creators.id] }),
}));

export const outreachThreadsRelations = relations(outreachThreads, ({ one, many }) => ({
  creator: one(creators, { fields: [outreachThreads.creatorId], references: [creators.id] }),
  campaign: one(campaigns, { fields: [outreachThreads.campaignId], references: [campaigns.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  thread: one(outreachThreads, { fields: [messages.threadId], references: [outreachThreads.id] }),
}));

export const affiliatesRelations = relations(affiliates, ({ one, many }) => ({
  creator: one(creators, { fields: [affiliates.creatorId], references: [creators.id] }),
  orders: many(ordersAttributed),
}));

export const ordersAttributedRelations = relations(ordersAttributed, ({ one }) => ({
  affiliate: one(affiliates, { fields: [ordersAttributed.affiliateId], references: [affiliates.id] }),
}));

export const contentMentionsRelations = relations(contentMentions, ({ one }) => ({
  creator: one(creators, { fields: [contentMentions.creatorId], references: [creators.id] }),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  creator: one(creators, { fields: [events.creatorId], references: [creators.id] }),
}));

/* ===========================================================================
 * discovery_candidates — competitor-discovery review queue (P1, Module A)
 * Surfaced from an external discovery source; deduped, then either approved into
 * `creators` or dismissed. Never auto-promoted.
 * ========================================================================= */
export const discoveryCandidateStatusEnum = pgEnum("discovery_candidate_status", [
  "new",
  "approved",
  "dismissed",
]);

export const discoveryCandidates = pgTable(
  "discovery_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: platformEnum("platform").notNull(),
    externalUserId: text("external_user_id"),
    handle: text("handle").notNull(),
    displayName: text("display_name"),
    url: text("url"),
    avatarUrl: text("avatar_url"),
    followers: integer("followers"),
    engagementRate: real("engagement_rate"),
    sourceCompetitor: text("source_competitor"), // which competitor brand surfaced them
    collaborationType: text("collaboration_type"), // Paid | Gifted | Ambassador | Affiliate | ...
    samplePostUrl: text("sample_post_url"),
    raw: jsonb("raw"),
    status: discoveryCandidateStatusEnum("status").notNull().default("new"),
    creatorId: uuid("creator_id").references(() => creators.id, { onDelete: "set null" }),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    platformUserUnique: uniqueIndex("discovery_candidates_platform_user_unique").on(
      t.platform,
      t.externalUserId,
    ),
    statusIdx: index("discovery_candidates_status_idx").on(t.status),
    handleIdx: index("discovery_candidates_handle_idx").on(t.handle),
  }),
);

export const discoveryCandidatesRelations = relations(discoveryCandidates, ({ one }) => ({
  creator: one(creators, { fields: [discoveryCandidates.creatorId], references: [creators.id] }),
}));

/* ===========================================================================
 * PULSE campaign module — HITL tiering decisions, learned model weights,
 * outreach event log, payout approvals.
 * ========================================================================= */
export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id),
  action: text("action").notNull(), // tier_a | tier_b | reject
  features: jsonb("features").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
});

export const modelWeights = pgTable("model_weights", {
  id: integer("id").primaryKey().default(1),
  weights: jsonb("weights").notNull().default({}),
  decisionCount: integer("decision_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outreachEvents = pgTable(
  "outreach_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id),
    type: text("type").notNull(), // pushed|sent|opened|replied|bounced|unsubscribed|nudge_sent
    classification: text("classification"), // interested|negotiating|later|no
    payload: jsonb("payload"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    creatorTimeIdx: index("outreach_creator_time_idx").on(t.creatorId, t.occurredAt),
  }),
);

export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id),
  half: text("half").notNull(), // signing | completion
  amountUsd: integer("amount_usd").notNull(),
  status: text("status").notNull().default("pending"), // pending|approved|paid
  approvedBy: text("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ===========================================================================
 * provisioning_claims — database-level mutual exclusion for gift provisioning.
 *
 * Shopify draft-order create has no native idempotency key, and Inngest delivers
 * `creator.tiered` / `tally/intake.submitted` at-least-once. The `note_attributes`
 * / tags marker (`pulse-gift-<creatorId>`) is defense-in-depth only. This table
 * is the authoritative guard: a worker atomically INSERTs a claim
 * (creatorId + giftKey unique) BEFORE any Shopify side effect. `ON CONFLICT DO
 * NOTHING` means exactly one concurrent worker wins the row; losers see zero
 * rows returned and abort. A `failed` claim can be retried (attempts++), while a
 * `completed` claim is terminal — the gift shipped once.
 * ========================================================================= */
export const provisioningClaims = pgTable(
  "provisioning_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    giftKey: text("gift_key").notNull(), // e.g. pulse-gift-<creatorId>
    status: text("status").notNull().default("claimed"), // claimed | completed | failed
    attempts: integer("attempts").notNull().default(1),
    draftOrderId: text("draft_order_id"),
    discountCode: text("discount_code"),
    lastError: text("last_error"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    creatorGiftUnique: uniqueIndex("provisioning_claims_creator_gift_unique").on(
      t.creatorId,
      t.giftKey,
    ),
  }),
);

export const provisioningClaimsRelations = relations(provisioningClaims, ({ one }) => ({
  creator: one(creators, { fields: [provisioningClaims.creatorId], references: [creators.id] }),
}));

/* ===========================================================================
 * import_batches / import_rows — provider-neutral CSV import audit trail.
 *
 * One batch per uploaded file. `file_hash` is UNIQUE so re-uploading the same
 * file is idempotent (the second attempt collides and is treated as a replay,
 * not a new import). Per-row outcomes are persisted for the results screen and a
 * downloadable error/conflict report. Nothing here sends email, moves a stage,
 * creates a gift, or starts a flow — it only records what the importer did.
 * ========================================================================= */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    fileHash: text("file_hash").notNull(),
    operator: text("operator"), // team member email who ran the import
    source: text("source").notNull().default("csv"),
    status: text("status").notNull().default("completed"), // completed | failed
    totalRows: integer("total_rows").notNull().default(0),
    enrichedCount: integer("enriched_count").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    conflictCount: integer("conflict_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    mapping: jsonb("mapping"), // header -> field mapping used
    errors: jsonb("errors"), // batch-level parse errors
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    fileHashUnique: uniqueIndex("import_batches_file_hash_unique").on(t.fileHash),
    createdIdx: index("import_batches_created_idx").on(t.createdAt),
  }),
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    rowHash: text("row_hash").notNull(),
    outcome: text("outcome").notNull(), // enriched | created | skipped | conflict | error | unchanged
    matchReason: text("match_reason"),
    matchConfidence: real("match_confidence"),
    creatorId: uuid("creator_id").references(() => creators.id, { onDelete: "set null" }),
    proposedChanges: jsonb("proposed_changes"), // { field: { from, to } }
    applied: boolean("applied").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    batchIdx: index("import_rows_batch_idx").on(t.batchId),
    batchRowUnique: uniqueIndex("import_rows_batch_row_unique").on(t.batchId, t.rowHash),
  }),
);

export const importBatchesRelations = relations(importBatches, ({ many }) => ({
  rows: many(importRows),
}));

export const importRowsRelations = relations(importRows, ({ one }) => ({
  batch: one(importBatches, { fields: [importRows.batchId], references: [importBatches.id] }),
  creator: one(creators, { fields: [importRows.creatorId], references: [creators.id] }),
}));
