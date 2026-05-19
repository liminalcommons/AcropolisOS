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

