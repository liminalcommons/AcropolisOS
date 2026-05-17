import type { Ontology } from "../ontology/schema";
import { snakeCase } from "./drizzle";

// Generic, append-only audit log mirroring every row-level change on tables
// whose object type opts in via `data_audit: true`. Append-only is enforced
// in code (writers only INSERT) and via REVOKE — defence in depth, mirroring
// ontology_audit/action_audit (US-008).
export const DATA_AUDIT_TABLE_DDL = `CREATE TABLE IF NOT EXISTS "data_audit" (
\t"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
\t"at" timestamp with time zone DEFAULT now() NOT NULL,
\t"table_name" text NOT NULL,
\t"row_id" text NOT NULL,
\t"operation" text NOT NULL,
\t"before" jsonb,
\t"after" jsonb,
\t"db_actor" text NOT NULL
);
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "data_audit" FROM PUBLIC;`;

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

// Emit the trigger function + AFTER trigger for a single table.
// Fires for INSERT, UPDATE, and DELETE; writes one row to data_audit with:
//   - operation = TG_OP
//   - row_id    = NEW.id on INSERT/UPDATE, OLD.id on DELETE
//   - before    = row_to_jsonb(OLD) for UPDATE/DELETE, NULL for INSERT
//   - after     = row_to_jsonb(NEW) for INSERT/UPDATE, NULL for DELETE
//   - db_actor  = current_user (session user — DB-level, distinct from app actor)
//
// The function name is `<table>_data_audit_fn` and the trigger
// `<table>_data_audit_trg` so multiple opt-in tables can coexist without
// clashing on a single shared function. Each table's trigger references its
// own OLD/NEW row shape, which row_to_jsonb resolves at runtime.
export function generateTriggerDDL(tableName: string): string {
  const fn = `${tableName}_data_audit_fn`;
  const trg = `${tableName}_data_audit_trg`;
  const tableLit = `'${tableName}'`;
  return [
    `CREATE OR REPLACE FUNCTION "${fn}"() RETURNS trigger AS $$`,
    `BEGIN`,
    `\tIF (TG_OP = 'DELETE') THEN`,
    `\t\tINSERT INTO "data_audit" ("table_name", "row_id", "operation", "before", "after", "db_actor")`,
    `\t\tVALUES (${tableLit}, OLD.id::text, TG_OP, row_to_jsonb(OLD), NULL, current_user);`,
    `\t\tRETURN OLD;`,
    `\tELSIF (TG_OP = 'UPDATE') THEN`,
    `\t\tINSERT INTO "data_audit" ("table_name", "row_id", "operation", "before", "after", "db_actor")`,
    `\t\tVALUES (${tableLit}, COALESCE(NEW.id, OLD.id)::text, TG_OP, row_to_jsonb(OLD), row_to_jsonb(NEW), current_user);`,
    `\t\tRETURN NEW;`,
    `\tELSIF (TG_OP = 'INSERT') THEN`,
    `\t\tINSERT INTO "data_audit" ("table_name", "row_id", "operation", "before", "after", "db_actor")`,
    `\t\tVALUES (${tableLit}, NEW.id::text, TG_OP, NULL, row_to_jsonb(NEW), current_user);`,
    `\t\tRETURN NEW;`,
    `\tEND IF;`,
    `\tRETURN NULL;`,
    `END;`,
    `$$ LANGUAGE plpgsql;`,
    STATEMENT_BREAKPOINT,
    `DROP TRIGGER IF EXISTS "${trg}" ON "${tableName}";`,
    STATEMENT_BREAKPOINT,
    `CREATE TRIGGER "${trg}"`,
    `AFTER INSERT OR UPDATE OR DELETE ON "${tableName}"`,
    `FOR EACH ROW EXECUTE FUNCTION "${fn}"();`,
  ].join("\n");
}

// Compose the full data_audit migration for an ontology: the generic table,
// then one trigger pair per object type that opts in via `data_audit: true`.
// Object types are visited in declaration order; the output is deterministic.
export function generateDataAuditMigration(ontology: Ontology): string {
  const parts: string[] = [DATA_AUDIT_TABLE_DDL];
  for (const [typeName, obj] of Object.entries(ontology.object_types)) {
    if (!obj.data_audit) continue;
    parts.push(STATEMENT_BREAKPOINT);
    parts.push(generateTriggerDDL(snakeCase(typeName)));
  }
  return parts.join("\n");
}
