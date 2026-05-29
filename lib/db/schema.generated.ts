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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// === Object types ===

export const agent_blocker = pgTable("agent_blocker", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  blocked_actor_id: uuid("blocked_actor_id").notNull().references((): AnyPgColumn => member.id),
  reason_kind: text("reason_kind").notNull(),
  summary: text("summary").notNull(),
  detail: text("detail").notNull(),
  blocked_work_ref: text("blocked_work_ref"),
  resolution_mode: text("resolution_mode").notNull().default("pathways"),
  pathways: text("pathways"),
  input_schema: text("input_schema"),
  confirm_action: text("confirm_action"),
  status: text("status").notNull().default("open"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
  resolved_by_action_audit_id: text("resolved_by_action_audit_id"),
  resolved_via_pathway_id: uuid("resolved_via_pathway_id"),
});

export const bed = pgTable("bed", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  code: text("code").notNull(),
  room: uuid("room").notNull().references((): AnyPgColumn => room.id),
  is_bottom_bunk: boolean("is_bottom_bunk").notNull().default(true),
  out_of_service: boolean("out_of_service").notNull().default(false),
  notes: text("notes"),
  work_trade_agreement_id: uuid("work_trade_agreement_id").references((): AnyPgColumn => work_trade_agreement.id),
});

export const booking = pgTable("booking", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  label: text("label").notNull(),
  guest: uuid("guest").notNull().references((): AnyPgColumn => guest.id),
  bed: uuid("bed").notNull().references((): AnyPgColumn => bed.id),
  from_date: date("from_date").notNull(),
  to_date: date("to_date").notNull(),
  rate_per_night: numeric("rate_per_night").notNull(),
  currency: text("currency").notNull().default("EUR"),
  source: text("source").notNull().default("direct"),
  status: text("status").notNull().default("confirmed"),
});

export const event = pgTable("event", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  title: text("title").notNull(),
  starts_at: timestamp("starts_at", { withTimezone: true }).notNull(),
  duration_hours: numeric("duration_hours").notNull().default("2"),
  attendance_cap: numeric("attendance_cap"),
  organizer: uuid("organizer").notNull().references((): AnyPgColumn => member.id),
  description: text("description"),
  status: text("status").notNull().default("scheduled"),
});

export const guest = pgTable("guest", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  full_name: text("full_name").notNull(),
  email: text("email").notNull(),
  country: text("country").notNull(),
  phone: text("phone").notNull(),
  arrived_at: date("arrived_at").notNull(),
  expected_departure: date("expected_departure").notNull(),
  current_status: text("current_status").notNull().default("booked"),
  is_work_trader: boolean("is_work_trader").notNull().default(false),
  notes: text("notes"),
});

export const incident_log = pgTable("incident_log", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  summary: text("summary").notNull(),
  body: text("body"),
  category: text("category").notNull(),
  severity: text("severity").notNull().default("low"),
  occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull(),
  reported_by: uuid("reported_by").notNull().references((): AnyPgColumn => member.id),
  resolved: boolean("resolved").notNull().default(false),
  resolution_notes: text("resolution_notes"),
});

export const meeting_minute = pgTable("meeting_minute", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  event_id: uuid("event_id").notNull().references((): AnyPgColumn => event.id),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const member_context = pgTable("member_context", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  member_id: uuid("member_id").notNull().references((): AnyPgColumn => member.id),
  pinned_widgets: text("pinned_widgets").notNull().default("[]"),
  theme_pref: text("theme_pref"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const member = pgTable("member", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  full_name: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  tier_role: text("tier_role").notNull().default("staff"),
  started_at: date("started_at").notNull(),
  notes: text("notes"),
});

export const notification = pgTable("notification", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  recipient_member_id: uuid("recipient_member_id").notNull().references((): AnyPgColumn => member.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  link_url: text("link_url"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  read_at: timestamp("read_at", { withTimezone: true }),
});

export const room = pgTable("room", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  code: text("code").notNull(),
  kind: text("kind").notNull(),
  capacity: numeric("capacity").notNull(),
  floor: numeric("floor"),
  notes: text("notes"),
});

export const shift = pgTable("shift", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  label: text("label").notNull(),
  kind: text("kind").notNull(),
  starts_at: timestamp("starts_at", { withTimezone: true }).notNull(),
  duration_hours: numeric("duration_hours").notNull(),
  claimed_by: uuid("claimed_by").references((): AnyPgColumn => member.id),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  member_id: uuid("member_id").notNull().references((): AnyPgColumn => member.id),
});

export const work_trade_agreement = pgTable("work_trade_agreement", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  label: text("label").notNull(),
  guest: uuid("guest").references((): AnyPgColumn => guest.id),
  bed_comp: uuid("bed_comp").notNull().references((): AnyPgColumn => bed.id),
  hours_per_week: numeric("hours_per_week").notNull().default("20"),
  start_date: date("start_date").notNull(),
  end_date: date("end_date").notNull(),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
});

// === Link tables (many-to-many) ===

export const guest_booked_into_bed = pgTable(
  "guest_booked_into_bed",
  {
    guest_id: uuid("guest_id").notNull().references((): AnyPgColumn => guest.id),
    bed_id: uuid("bed_id").notNull().references((): AnyPgColumn => bed.id),
    booking: uuid("booking").notNull().references((): AnyPgColumn => booking.id),
  },
  (t) => [primaryKey({ columns: [t.guest_id, t.bed_id] })],
);

export const member_attended_event = pgTable(
  "member_attended_event",
  {
    member_id: uuid("member_id").notNull().references((): AnyPgColumn => member.id),
    event_id: uuid("event_id").notNull().references((): AnyPgColumn => event.id),
    attended_at: timestamp("attended_at", { withTimezone: true }).notNull(),
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.member_id, t.event_id] })],
);

export const guest_attended_event_event = pgTable(
  "guest_attended_event_event",
  {
    guest_id: uuid("guest_id").notNull().references((): AnyPgColumn => guest.id),
    event_id: uuid("event_id").notNull().references((): AnyPgColumn => event.id),
  },
  (t) => [primaryKey({ columns: [t.guest_id, t.event_id] })],
);

export const incident_log_involves_guest = pgTable(
  "incident_log_involves_guest",
  {
    incident_log_id: uuid("incident_log_id").notNull().references((): AnyPgColumn => incident_log.id),
    guest_id: uuid("guest_id").notNull().references((): AnyPgColumn => guest.id),
  },
  (t) => [primaryKey({ columns: [t.incident_log_id, t.guest_id] })],
);

// Registry of all object-type tables keyed by PascalCase ontology name.
// Generated — used by the read-only data API to resolve a validated type to its table.
export const TABLES = {
  AgentBlocker: agent_blocker,
  Bed: bed,
  Booking: booking,
  Event: event,
  Guest: guest,
  IncidentLog: incident_log,
  MeetingMinute: meeting_minute,
  MemberContext: member_context,
  Member: member,
  Notification: notification,
  Room: room,
  Shift: shift,
  WorkTradeAgreement: work_trade_agreement,
} as const;
