ALTER TABLE "creators" ADD COLUMN "pulse_fit" jsonb;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "ring" text;--> statement-breakpoint
CREATE INDEX "creators_ring_idx" ON "creators" USING btree ("ring");