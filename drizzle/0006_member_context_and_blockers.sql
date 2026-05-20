-- M4.3: member_context (per-member /me state) + agent_blocker (escalation queue).
--
-- Pre-created with CREATE TABLE IF NOT EXISTS so drizzle-kit push --force
-- doesn't open the interactive rename-vs-create prompt (mirrors 0005_notification.sql
-- pattern). FK wrapped in DO blocks for idempotency.
CREATE TABLE IF NOT EXISTS "member_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"pinned_widgets" text NOT NULL DEFAULT '[]',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_member_context_member" ON "member_context" ("member_id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'member_context_member_id_fk'
      AND table_name = 'member_context'
  ) THEN
    ALTER TABLE "member_context"
      ADD CONSTRAINT "member_context_member_id_fk"
      FOREIGN KEY ("member_id")
      REFERENCES "member"("id")
      ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_blocker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocked_actor_id" uuid NOT NULL,
	"reason_kind" text NOT NULL,
	"summary" text NOT NULL,
	"detail" text NOT NULL,
	"blocked_work_ref" text,
	"unblock_hint" text,
	"status" text NOT NULL DEFAULT 'open',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_action_audit_id" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_blocker_actor_status" ON "agent_blocker" ("blocked_actor_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_blocker_status_created" ON "agent_blocker" ("status", "created_at");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'agent_blocker_blocked_actor_id_fk'
      AND table_name = 'agent_blocker'
  ) THEN
    ALTER TABLE "agent_blocker"
      ADD CONSTRAINT "agent_blocker_blocked_actor_id_fk"
      FOREIGN KEY ("blocked_actor_id")
      REFERENCES "member"("id")
      ON DELETE CASCADE;
  END IF;
END $$;
