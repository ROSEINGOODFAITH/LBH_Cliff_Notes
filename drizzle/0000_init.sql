CREATE TYPE "public"."affiliate_status" AS ENUM('pending', 'active', 'paused', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."ai_interest_label" AS ENUM('interested', 'maybe', 'not_interested', 'needs_follow_up', 'ooo');--> statement-breakpoint
CREATE TYPE "public"."campaign_objective" AS ENUM('gifting', 'affiliate', 'paid');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."creator_source" AS ENUM('modash', 'first_party', 'manual', 'competitor_mention');--> statement-breakpoint
CREATE TYPE "public"."creator_status" AS ENUM('prospect', 'contacted', 'replied', 'negotiating', 'active', 'declined', 'dormant');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."outreach_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."outreach_status" AS ENUM('draft', 'queued', 'sent', 'awaiting_reply', 'replied', 'closed');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('instagram', 'tiktok', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."post_type" AS ENUM('story', 'post', 'reel', 'tiktok', 'short');--> statement-breakpoint
CREATE TABLE "affiliates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"discount_code" text NOT NULL,
	"affiliate_link" text,
	"commission_pct" numeric(5, 2),
	"shopify_price_rule_id" text,
	"shopify_discount_id" text,
	"status" "affiliate_status" DEFAULT 'pending' NOT NULL,
	"signed_up_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"stage" "creator_status" DEFAULT 'prospect' NOT NULL,
	"owner" text,
	"last_touch" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"objective" "campaign_objective" DEFAULT 'gifting' NOT NULL,
	"product_skus" text[],
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"post_url" text NOT NULL,
	"post_type" "post_type",
	"posted_at" timestamp with time zone,
	"caption" text,
	"media_url" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_socials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"handle" text NOT NULL,
	"url" text,
	"followers" integer,
	"last_synced" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"email" text,
	"primary_platform" "platform",
	"follower_count" integer,
	"engagement_rate" real,
	"niche_tags" text[],
	"audience_geo" jsonb,
	"audience_age" jsonb,
	"avatar_url" text,
	"source" "creator_source" DEFAULT 'manual' NOT NULL,
	"modash_id" text,
	"modash_last_enriched_at" timestamp with time zone,
	"status" "creator_status" DEFAULT 'prospect' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"classification_json" jsonb,
	"gmail_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders_attributed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shopify_order_id" text NOT NULL,
	"affiliate_id" uuid,
	"discount_code" text,
	"subtotal_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"order_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"campaign_id" uuid,
	"channel" "outreach_channel" DEFAULT 'email' NOT NULL,
	"subject" text,
	"status" "outreach_status" DEFAULT 'draft' NOT NULL,
	"ai_interest_label" "ai_interest_label",
	"gmail_thread_id" text,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_creators" ADD CONSTRAINT "campaign_creators_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_creators" ADD CONSTRAINT "campaign_creators_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_mentions" ADD CONSTRAINT "content_mentions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_socials" ADD CONSTRAINT "creator_socials_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_outreach_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."outreach_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_attributed" ADD CONSTRAINT "orders_attributed_affiliate_id_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_threads" ADD CONSTRAINT "outreach_threads_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_threads" ADD CONSTRAINT "outreach_threads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliates_creator_unique" ON "affiliates" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliates_discount_code_unique" ON "affiliates" USING btree ("discount_code");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_creators_unique" ON "campaign_creators" USING btree ("campaign_id","creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_mentions_post_url_unique" ON "content_mentions" USING btree ("post_url");--> statement-breakpoint
CREATE INDEX "content_mentions_creator_idx" ON "content_mentions" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_socials_creator_platform_unique" ON "creator_socials" USING btree ("creator_id","platform");--> statement-breakpoint
CREATE INDEX "creators_status_idx" ON "creators" USING btree ("status");--> statement-breakpoint
CREATE INDEX "creators_source_idx" ON "creators" USING btree ("source");--> statement-breakpoint
CREATE INDEX "creators_handle_idx" ON "creators" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_modash_id_unique" ON "creators" USING btree ("modash_id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "events_creator_idx" ON "events" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_gmail_message_unique" ON "messages" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_attributed_shopify_order_unique" ON "orders_attributed" USING btree ("shopify_order_id");--> statement-breakpoint
CREATE INDEX "orders_attributed_affiliate_idx" ON "orders_attributed" USING btree ("affiliate_id");--> statement-breakpoint
CREATE INDEX "outreach_threads_creator_idx" ON "outreach_threads" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "outreach_threads_label_idx" ON "outreach_threads" USING btree ("ai_interest_label");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_threads_gmail_thread_unique" ON "outreach_threads" USING btree ("gmail_thread_id");