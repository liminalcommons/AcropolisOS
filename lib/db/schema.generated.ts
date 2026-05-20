// THIS FILE IS GENERATED. DO NOT EDIT.
// Source: lib/codegen/drizzle.ts — regenerate via the ontology codegen pipeline.

import {
  pgTable,
  boolean,
  date,
  integer,
  numeric,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// === Object types ===

export const event = pgTable("event", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  title: text("title").notNull(),
  starts_at: timestamp("starts_at", { withTimezone: true }).notNull(),
  location: text("location").notNull(),
  description: text("description").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const meeting_minute = pgTable("meeting_minute", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  event_id: uuid("event_id").notNull().references(() => event.id),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  member_id: uuid("member_id").notNull().references(() => member.id),
});

export const member = pgTable("member", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  full_name: text("full_name").notNull(),
  email: text("email").notNull(),
  joined_at: date("joined_at").notNull(),
  tier: text("tier").notNull().default("basic"),
  notes: text("notes").notNull(),
  user_id: text("user_id"),
  invite_code: text("invite_code"),
  invite_expires_at: timestamp("invite_expires_at", { withTimezone: true }),
});

export const notification = pgTable("notification", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  recipient_member_id: uuid("recipient_member_id").notNull().references(() => member.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  link_url: text("link_url"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  read_at: timestamp("read_at", { withTimezone: true }),
});

// M4.3: member context + agent escalation blockers (manually added; codegen
// not runnable in worktree — mirrors YAML specs in seed/small-community/).
export const member_context = pgTable("member_context", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  member_id: uuid("member_id").notNull().references(() => member.id),
  pinned_widgets: text("pinned_widgets").notNull().default("[]"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const agent_blocker = pgTable("agent_blocker", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  blocked_actor_id: uuid("blocked_actor_id").notNull().references(() => member.id),
  reason_kind: text("reason_kind").notNull(),
  summary: text("summary").notNull(),
  detail: text("detail").notNull(),
  blocked_work_ref: text("blocked_work_ref"),
  unblock_hint: text("unblock_hint"),
  status: text("status").notNull().default("open"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
  resolved_by_action_audit_id: text("resolved_by_action_audit_id"),
});

// === Link tables (many-to-many) ===

export const member_attended_event = pgTable(
  "member_attended_event",
  {
    member_id: uuid("member_id").notNull().references(() => member.id),
    event_id: uuid("event_id").notNull().references(() => event.id),
    attended_at: timestamp("attended_at", { withTimezone: true }).notNull(),
    role: text("role").notNull().default("attendee"),
  },
  (t) => [primaryKey({ columns: [t.member_id, t.event_id] })],
);

