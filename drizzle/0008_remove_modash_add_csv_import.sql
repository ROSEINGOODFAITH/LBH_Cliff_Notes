-- Provider neutralization + CSV import audit trail.
--
-- All column changes are RENAMEs (data-preserving) — no creator data is dropped.
-- The `creator_source` enum keeps its historical "modash" value (Postgres cannot
-- remove an in-use enum value) and gains "csv" for new imports.

-- 1) Rename provider-specific creator columns to neutral names (preserves data).
ALTER TABLE "creators" RENAME COLUMN "modash_id" TO "external_id";--> statement-breakpoint
ALTER TABLE "creators" RENAME COLUMN "modash_last_enriched_at" TO "last_enriched_at";--> statement-breakpoint
ALTER TABLE "creators" RENAME COLUMN "raw_modash" TO "source_metadata";--> statement-breakpoint

-- 2) Rename the matching unique index to match the new column name.
ALTER INDEX "creators_modash_id_unique" RENAME TO "creators_external_id_unique";--> statement-breakpoint

-- 3) Rename the discovery-candidate provider id column.
ALTER TABLE "discovery_candidates" RENAME COLUMN "modash_user_id" TO "external_user_id";--> statement-breakpoint

-- 4) Add the "csv" source value (historical "modash" rows remain valid).
ALTER TYPE "creator_source" ADD VALUE IF NOT EXISTS 'csv';--> statement-breakpoint

-- 5) Import audit tables.
CREATE TABLE IF NOT EXISTS "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"file_hash" text NOT NULL,
	"operator" text,
	"source" text DEFAULT 'csv' NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"enriched_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"mapping" jsonb,
	"errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_file_hash_unique" ON "import_batches" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "import_batches_created_idx" ON "import_batches" USING btree ("created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"row_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"match_reason" text,
	"match_confidence" real,
	"creator_id" uuid,
	"proposed_changes" jsonb,
	"applied" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_batch_row_unique" ON "import_rows" USING btree ("batch_id","row_hash");
