-- M4.1: notification inbox table.
--
-- Pre-created with CREATE TABLE IF NOT EXISTS so drizzle-kit push --force
-- doesn't open the interactive rename-vs-create prompt (the gotcha doc'd
-- in docker-entrypoint.sh: drizzle-kit push errors with
-- "Interactive prompts require a TTY terminal" when a brand-new table
-- could plausibly be a rename of an existing one). Mirrors drizzle/
-- 0003_data_audit.sql + 0004_proposals.sql pattern.
CREATE TABLE IF NOT EXISTS "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_recipient_created_at_idx" ON "notification" ("recipient_member_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_recipient_unread_idx" ON "notification" ("recipient_member_id") WHERE "read_at" IS NULL;
--> statement-breakpoint
-- M4.1 cleanup (#29): add FK from notification.recipient_member_id → member.id.
-- schema.generated.ts declared this FK but the original SQL omitted it.
-- Wrapped in a DO block for idempotency (Postgres lacks ADD CONSTRAINT IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notification_recipient_member_id_fk'
      AND table_name = 'notification'
  ) THEN
    ALTER TABLE "notification"
      ADD CONSTRAINT "notification_recipient_member_id_fk"
      FOREIGN KEY ("recipient_member_id")
      REFERENCES "member"("id")
      ON DELETE CASCADE;
  END IF;
END $$;
