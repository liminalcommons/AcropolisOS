import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const _meta = pgTable("_meta", {
  key: text("key").primaryKey().notNull(),
  value: jsonb("value").notNull().default(sql`'{}'::jsonb`),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MetaRow = typeof _meta.$inferSelect;
export type MetaInsert = typeof _meta.$inferInsert;

const auditColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  actor_role: text("actor_role").notNull(),
  via: text("via").notNull(),
  subject_type: text("subject_type").notNull(),
  subject_id: text("subject_id").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
});

export const ontology_audit = pgTable("ontology_audit", auditColumns());
export const action_audit = pgTable("action_audit", auditColumns());

export type OntologyAuditRow = typeof ontology_audit.$inferSelect;
export type OntologyAuditInsert = typeof ontology_audit.$inferInsert;
export type ActionAuditRow = typeof action_audit.$inferSelect;
export type ActionAuditInsert = typeof action_audit.$inferInsert;
