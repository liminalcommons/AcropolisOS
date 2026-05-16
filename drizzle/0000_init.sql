CREATE TABLE "_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Apache AGE is bundled into the platform but unused in v0; create the
-- extension only when the cluster advertises it via pg_available_extensions.
-- Stays a no-op on Postgres installations without the AGE binary.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_available_extensions WHERE name = 'age'
	) THEN
		CREATE EXTENSION IF NOT EXISTS age;
	END IF;
END
$$;
