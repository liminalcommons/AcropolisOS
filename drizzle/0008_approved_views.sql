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
