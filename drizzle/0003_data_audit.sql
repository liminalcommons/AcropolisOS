CREATE TABLE IF NOT EXISTS "data_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"operation" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"db_actor" text NOT NULL
);
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "data_audit" FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "member_data_audit_fn"() RETURNS trigger AS $$
BEGIN
	IF (TG_OP = 'DELETE') THEN
		INSERT INTO "data_audit" ("table_name", "row_id", "operation", "before", "after", "db_actor")
		VALUES ('member', OLD.id::text, TG_OP, row_to_jsonb(OLD), NULL, current_user);
		RETURN OLD;
	ELSIF (TG_OP = 'UPDATE') THEN
		INSERT INTO "data_audit" ("table_name", "row_id", "operation", "before", "after", "db_actor")
		VALUES ('member', COALESCE(NEW.id, OLD.id)::text, TG_OP, row_to_jsonb(OLD), row_to_jsonb(NEW), current_user);
		RETURN NEW;
	ELSIF (TG_OP = 'INSERT') THEN
		INSERT INTO "data_audit" ("table_name", "row_id", "operation", "before", "after", "db_actor")
		VALUES ('member', NEW.id::text, TG_OP, NULL, row_to_jsonb(NEW), current_user);
		RETURN NEW;
	END IF;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "member_data_audit_trg" ON "member";
--> statement-breakpoint
CREATE TRIGGER "member_data_audit_trg"
AFTER INSERT OR UPDATE OR DELETE ON "member"
FOR EACH ROW EXECUTE FUNCTION "member_data_audit_fn"();
