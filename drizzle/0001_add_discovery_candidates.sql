CREATE TYPE "public"."discovery_candidate_status" AS ENUM('new', 'approved', 'dismissed');--> statement-breakpoint
CREATE TABLE "discovery_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"modash_user_id" text,
	"handle" text NOT NULL,
	"display_name" text,
	"url" text,
	"avatar_url" text,
	"followers" integer,
	"engagement_rate" real,
	"source_competitor" text,
	"collaboration_type" text,
	"sample_post_url" text,
	"raw" jsonb,
	"status" "discovery_candidate_status" DEFAULT 'new' NOT NULL,
	"creator_id" uuid,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_candidates_platform_user_unique" ON "discovery_candidates" USING btree ("platform","modash_user_id");--> statement-breakpoint
CREATE INDEX "discovery_candidates_status_idx" ON "discovery_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "discovery_candidates_handle_idx" ON "discovery_candidates" USING btree ("handle");