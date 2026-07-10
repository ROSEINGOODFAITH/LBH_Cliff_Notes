CREATE TYPE "public"."creator_stage" AS ENUM('sourced', 'review', 'contacted', 'replied', 'onboarded', 'shipped', 'posted', 'paid', 'rejected', 'churned');--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"action" text NOT NULL,
	"features" jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_weights" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"type" text NOT NULL,
	"classification" text,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"half" text NOT NULL,
	"amount_usd" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "avg_views" integer;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "fake_follower_pct" real;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "geo" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "niche" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "aesthetic_score" integer;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "fit_score" integer DEFAULT 50;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "stage" "creator_stage" DEFAULT 'sourced' NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "discount_code" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "rate_usd" integer;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "shopify_draft_order_id" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "post_url" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "post_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "disclosure_ok" boolean;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "raw_modash" jsonb;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_creator_time_idx" ON "outreach_events" USING btree ("creator_id","occurred_at");--> statement-breakpoint
CREATE INDEX "creators_stage_idx" ON "creators" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "creators_fit_idx" ON "creators" USING btree ("fit_score");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_discount_code_unique" ON "creators" USING btree ("discount_code");