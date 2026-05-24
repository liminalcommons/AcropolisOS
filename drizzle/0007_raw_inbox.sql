-- F4: raw_inbox — staging table for inbound guest/booking data before classification.
--
-- Not an ontology object type — infra table. NOT managed by codegen.
-- Pattern mirrors 0006 (IF NOT EXISTS + idempotent FK DO blocks).
CREATE TABLE IF NOT EXISTS "raw_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL DEFAULT now(),
	"payload" jsonb NOT NULL,
	"classified_as" text,
	"classified_at" timestamp with time zone,
	"classified_by" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_raw_inbox_source" ON "raw_inbox" ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_raw_inbox_classified_as" ON "raw_inbox" ("classified_as");
