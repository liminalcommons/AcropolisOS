-- drizzle/0008_approved_views.sql
CREATE TABLE IF NOT EXISTS "approved_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "scope_key" text NOT NULL,
  "descriptors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "approved_views_scope_key_unique" UNIQUE ("scope", "scope_key")
);

-- Backfill: CREATE TABLE IF NOT EXISTS skips a pre-existing approved_views, so a DB
-- created before `descriptors` existed never gets the column → the boot post-push
-- verify (check_column approved_views descriptors) FATALs on the next restart. This
-- idempotent, default-backed ALTER self-heals such DBs on every boot. (Silent-skip
-- migration gotcha: a new column on an existing table needs an explicit ALTER.)
ALTER TABLE "approved_views" ADD COLUMN IF NOT EXISTS "descriptors" jsonb NOT NULL DEFAULT '[]'::jsonb;
