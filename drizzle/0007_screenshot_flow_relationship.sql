ALTER TABLE "creators" ADD COLUMN "relationship_tier" text;--> statement-breakpoint
CREATE INDEX "creators_relationship_tier_idx" ON "creators" USING btree ("relationship_tier");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"action_type" text NOT NULL,
	"stage" text,
	"tiers" text[] NOT NULL,
	"template_key" text,
	"delay_minutes" integer,
	"approval_required" boolean DEFAULT true NOT NULL,
	"auto_sends_external" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_step_key" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "flow_steps_key_unique" ON "flow_steps" USING btree ("key");--> statement-breakpoint
CREATE INDEX "flow_steps_position_idx" ON "flow_steps" USING btree ("position");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"thread_id" uuid,
	"scheduled_for" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_thread_id_outreach_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."outreach_threads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "flow_runs_creator_step_unique" ON "flow_runs" USING btree ("creator_id","step_key");--> statement-breakpoint
CREATE INDEX "flow_runs_creator_idx" ON "flow_runs" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "flow_runs_status_idx" ON "flow_runs" USING btree ("status");
