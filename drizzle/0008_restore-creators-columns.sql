-- Corrective migration: on 2026-07-13 ~20:37 UTC an out-of-band schema push
-- dropped columns from "creators" (observed: modash_id, raw_modash) while the
-- migration journal stayed at head, so `drizzle-kit migrate` could not heal it.
-- Restore EVERY column the current schema expects, idempotently. Columns that
-- still exist are untouched (IF NOT EXISTS); data in dropped columns is not
-- recoverable here (Neon point-in-time restore is the recovery path if needed).
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "display_name" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "ig_handle" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "primary_platform" "platform";--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "follower_count" integer;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "engagement_rate" real;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "niche_tags" text[];--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "audience_geo" jsonb;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "audience_age" jsonb;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "avatar_url" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "source" "creator_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "modash_id" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "modash_last_enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "status" "creator_status" DEFAULT 'prospect' NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "avg_views" integer;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "fake_follower_pct" real;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "geo" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "niche" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "aesthetic_score" integer;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "fit_score" integer DEFAULT 50;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "pulse_fit" jsonb;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "ring" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "relationship_tier" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "stage" "creator_stage" DEFAULT 'sourced' NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "tier" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "discount_code" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "rate_usd" integer;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "shopify_draft_order_id" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "tracking_number" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "post_url" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "post_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "disclosure_ok" boolean;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "raw_modash" jsonb;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creators_status_idx" ON "creators" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creators_source_idx" ON "creators" ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creators_handle_idx" ON "creators" ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "creators_modash_id_unique" ON "creators" ("modash_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creators_stage_idx" ON "creators" ("stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creators_fit_idx" ON "creators" ("fit_score");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "creators_discount_code_unique" ON "creators" ("discount_code");
