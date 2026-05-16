CREATE TABLE "ontology_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"actor_role" text NOT NULL,
	"via" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"actor_role" text NOT NULL,
	"via" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
-- Append-only: revoke UPDATE and DELETE from PUBLIC on both audit tables so
-- the only mutation surface is INSERT. Application writers should also
-- enforce this; the grant is a defence-in-depth backstop.
REVOKE UPDATE, DELETE ON "ontology_audit" FROM PUBLIC;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "action_audit" FROM PUBLIC;
