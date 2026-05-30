import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Re-export YAML-derived object/link tables so drizzle-kit sees them when
// resolving migrations and `db:push`. Without this, the object tables (member,
// event, …) live only in the generated module and are invisible to migration
// tooling — making 0003_data_audit fail because `member` doesn't exist yet.
export * from "./schema.generated";

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

export const inbox = pgTable("inbox", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  source_filename: text("source_filename").notNull(),
  mime_type: text("mime_type").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  claimed_by_proposal_id: uuid("claimed_by_proposal_id"),
});

export type InboxRow = typeof inbox.$inferSelect;
export type InboxInsert = typeof inbox.$inferInsert;

export const proposal_drafts = pgTable("proposal_drafts", {
  session_id: text("session_id").primaryKey().notNull(),
  diff: jsonb("diff").notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProposalDraftRow = typeof proposal_drafts.$inferSelect;
export type ProposalDraftInsert = typeof proposal_drafts.$inferInsert;

export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  session_id: text("session_id").notNull(),
  diff: jsonb("diff").notNull(),
  status: text("status").notNull().default("pending"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProposalRow = typeof proposals.$inferSelect;
export type ProposalInsert = typeof proposals.$inferInsert;

// F4: raw_inbox — staging table for messy inbound data before classification.
// Not an ontology object type — infra table, managed here (not in schema.generated.ts).
export const raw_inbox = pgTable("raw_inbox", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  source: text("source").notNull(),
  received_at: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").notNull(),
  classified_as: text("classified_as"),
  classified_at: timestamp("classified_at", { withTimezone: true }),
  classified_by: text("classified_by"),
});

export type RawInboxRow = typeof raw_inbox.$inferSelect;
export type RawInboxInsert = typeof raw_inbox.$inferInsert;

// Slice 3: approved_views — the governed-view registry. NOT an ontology object
// type (infra table, managed here like proposals/raw_inbox). Populated ONLY via
// the proposal apply loop. scope ∈ {org, role, viewer}; scope_key is "" for org,
// the role name for role, the member id for viewer. descriptors is the same
// widget-descriptor list shape the render path consumes. One active row per
// (scope, scope_key).
export const approved_views = pgTable("approved_views", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  scope: text("scope").notNull(),
  scope_key: text("scope_key").notNull(),
  descriptors: jsonb("descriptors").notNull().default(sql`'[]'::jsonb`),
  created_by: text("created_by").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApprovedViewRow = typeof approved_views.$inferSelect;
export type ApprovedViewInsert = typeof approved_views.$inferInsert;
