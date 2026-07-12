-- Backfill: translate the legacy CRM `status` onto the canonical `stage` for
-- any creator still at the default 'sourced' (i.e. never advanced by the PULSE
-- flow). Monotonic: we never regress a PULSE-advanced creator, so this only
-- fills rows the legacy path touched but the stage machine never did. Mapping
-- mirrors STATUS_TO_STAGE in lib/lifecycle.ts. Must run before `status` is
-- deprecated below (values are still intact here).
UPDATE "creators" SET "stage" = (CASE "status"
	WHEN 'contacted' THEN 'contacted'
	WHEN 'replied' THEN 'replied'
	WHEN 'negotiating' THEN 'replied'
	WHEN 'active' THEN 'onboarded'
	WHEN 'declined' THEN 'rejected'
	WHEN 'dormant' THEN 'churned'
END)::"creator_stage"
WHERE "stage" = 'sourced'
	AND "status" IN ('contacted', 'replied', 'negotiating', 'active', 'declined', 'dormant');--> statement-breakpoint
CREATE TABLE "provisioning_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"gift_key" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"draft_order_id" text,
	"discount_code" text,
	"last_error" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creators" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "creators" ALTER COLUMN "status" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provisioning_claims" ADD CONSTRAINT "provisioning_claims_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provisioning_claims_creator_gift_unique" ON "provisioning_claims" USING btree ("creator_id","gift_key");