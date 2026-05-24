// THIS FILE IS GENERATED. DO NOT EDIT.
// Source: lib/codegen/mastra-tools.ts — regenerate via the ontology codegen pipeline.

import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import {
  AgentBlockerSchema,
  BedSchema,
  BookingSchema,
  EventSchema,
  GuestSchema,
  IncidentLogSchema,
  MeetingMinuteSchema,
  MemberContextSchema,
  MemberSchema,
  NotificationSchema,
  RoomSchema,
  ShiftSchema,
  WorkTradeAgreementSchema,
  ChangeTierParamsSchema,
  CheckInParamsSchema,
  CheckOutParamsSchema,
  ClaimShiftParamsSchema,
  DismissBlockerParamsSchema,
  FlagBlockerParamsSchema,
  LogIncidentParamsSchema,
  MarkNotificationReadParamsSchema,
  PromoteToStewardParamsSchema,
  ResolveBlockerWithCustomParamsSchema,
  ResolveBlockerWithInputParamsSchema,
  ResolveBlockerWithPathwayParamsSchema,
  StartWorkTradeParamsSchema,
} from "../ontology/types.generated";

// === READ tools (one per READ op × object type) ===

export const describe_agent_blockerTool = createTool({
  id: "describe_agent_blocker",
  description: "Describe the AgentBlocker object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_agent_blocker not implemented (US-014)"); },
});

export const query_agent_blockerTool = createTool({
  id: "query_agent_blocker",
  description: "Query AgentBlocker records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(AgentBlockerSchema) }),
  execute: async () => { throw new Error("query_agent_blocker not implemented (US-014)"); },
});

export const traverse_agent_blockerTool = createTool({
  id: "traverse_agent_blocker",
  description: "Traverse links from a AgentBlocker record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_agent_blocker not implemented (US-014)"); },
});

export const sample_agent_blockerTool = createTool({
  id: "sample_agent_blocker",
  description: "Return up to N representative AgentBlocker records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(AgentBlockerSchema) }),
  execute: async () => { throw new Error("sample_agent_blocker not implemented (US-014)"); },
});

export const read_agent_blockerTool = createTool({
  id: "read_agent_blocker",
  description: "Read a single AgentBlocker record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: AgentBlockerSchema.nullable() }),
  execute: async () => { throw new Error("read_agent_blocker not implemented (US-014)"); },
});

export const audit_agent_blockerTool = createTool({
  id: "audit_agent_blocker",
  description: "Return recent audit entries scoped to AgentBlocker.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_agent_blocker not implemented (US-014)"); },
});

export const describe_bedTool = createTool({
  id: "describe_bed",
  description: "Describe the Bed object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_bed not implemented (US-014)"); },
});

export const query_bedTool = createTool({
  id: "query_bed",
  description: "Query Bed records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(BedSchema) }),
  execute: async () => { throw new Error("query_bed not implemented (US-014)"); },
});

export const traverse_bedTool = createTool({
  id: "traverse_bed",
  description: "Traverse links from a Bed record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_bed not implemented (US-014)"); },
});

export const sample_bedTool = createTool({
  id: "sample_bed",
  description: "Return up to N representative Bed records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(BedSchema) }),
  execute: async () => { throw new Error("sample_bed not implemented (US-014)"); },
});

export const read_bedTool = createTool({
  id: "read_bed",
  description: "Read a single Bed record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: BedSchema.nullable() }),
  execute: async () => { throw new Error("read_bed not implemented (US-014)"); },
});

export const audit_bedTool = createTool({
  id: "audit_bed",
  description: "Return recent audit entries scoped to Bed.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_bed not implemented (US-014)"); },
});

export const describe_bookingTool = createTool({
  id: "describe_booking",
  description: "Describe the Booking object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_booking not implemented (US-014)"); },
});

export const query_bookingTool = createTool({
  id: "query_booking",
  description: "Query Booking records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(BookingSchema) }),
  execute: async () => { throw new Error("query_booking not implemented (US-014)"); },
});

export const traverse_bookingTool = createTool({
  id: "traverse_booking",
  description: "Traverse links from a Booking record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_booking not implemented (US-014)"); },
});

export const sample_bookingTool = createTool({
  id: "sample_booking",
  description: "Return up to N representative Booking records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(BookingSchema) }),
  execute: async () => { throw new Error("sample_booking not implemented (US-014)"); },
});

export const read_bookingTool = createTool({
  id: "read_booking",
  description: "Read a single Booking record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: BookingSchema.nullable() }),
  execute: async () => { throw new Error("read_booking not implemented (US-014)"); },
});

export const audit_bookingTool = createTool({
  id: "audit_booking",
  description: "Return recent audit entries scoped to Booking.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_booking not implemented (US-014)"); },
});

export const describe_eventTool = createTool({
  id: "describe_event",
  description: "Describe the Event object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_event not implemented (US-014)"); },
});

export const query_eventTool = createTool({
  id: "query_event",
  description: "Query Event records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(EventSchema) }),
  execute: async () => { throw new Error("query_event not implemented (US-014)"); },
});

export const traverse_eventTool = createTool({
  id: "traverse_event",
  description: "Traverse links from a Event record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_event not implemented (US-014)"); },
});

export const sample_eventTool = createTool({
  id: "sample_event",
  description: "Return up to N representative Event records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(EventSchema) }),
  execute: async () => { throw new Error("sample_event not implemented (US-014)"); },
});

export const read_eventTool = createTool({
  id: "read_event",
  description: "Read a single Event record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: EventSchema.nullable() }),
  execute: async () => { throw new Error("read_event not implemented (US-014)"); },
});

export const audit_eventTool = createTool({
  id: "audit_event",
  description: "Return recent audit entries scoped to Event.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_event not implemented (US-014)"); },
});

export const describe_guestTool = createTool({
  id: "describe_guest",
  description: "Describe the Guest object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_guest not implemented (US-014)"); },
});

export const query_guestTool = createTool({
  id: "query_guest",
  description: "Query Guest records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(GuestSchema) }),
  execute: async () => { throw new Error("query_guest not implemented (US-014)"); },
});

export const traverse_guestTool = createTool({
  id: "traverse_guest",
  description: "Traverse links from a Guest record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_guest not implemented (US-014)"); },
});

export const sample_guestTool = createTool({
  id: "sample_guest",
  description: "Return up to N representative Guest records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(GuestSchema) }),
  execute: async () => { throw new Error("sample_guest not implemented (US-014)"); },
});

export const read_guestTool = createTool({
  id: "read_guest",
  description: "Read a single Guest record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: GuestSchema.nullable() }),
  execute: async () => { throw new Error("read_guest not implemented (US-014)"); },
});

export const audit_guestTool = createTool({
  id: "audit_guest",
  description: "Return recent audit entries scoped to Guest.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_guest not implemented (US-014)"); },
});

export const describe_incident_logTool = createTool({
  id: "describe_incident_log",
  description: "Describe the IncidentLog object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_incident_log not implemented (US-014)"); },
});

export const query_incident_logTool = createTool({
  id: "query_incident_log",
  description: "Query IncidentLog records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(IncidentLogSchema) }),
  execute: async () => { throw new Error("query_incident_log not implemented (US-014)"); },
});

export const traverse_incident_logTool = createTool({
  id: "traverse_incident_log",
  description: "Traverse links from a IncidentLog record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_incident_log not implemented (US-014)"); },
});

export const sample_incident_logTool = createTool({
  id: "sample_incident_log",
  description: "Return up to N representative IncidentLog records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(IncidentLogSchema) }),
  execute: async () => { throw new Error("sample_incident_log not implemented (US-014)"); },
});

export const read_incident_logTool = createTool({
  id: "read_incident_log",
  description: "Read a single IncidentLog record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: IncidentLogSchema.nullable() }),
  execute: async () => { throw new Error("read_incident_log not implemented (US-014)"); },
});

export const audit_incident_logTool = createTool({
  id: "audit_incident_log",
  description: "Return recent audit entries scoped to IncidentLog.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_incident_log not implemented (US-014)"); },
});

export const describe_meeting_minuteTool = createTool({
  id: "describe_meeting_minute",
  description: "Describe the MeetingMinute object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_meeting_minute not implemented (US-014)"); },
});

export const query_meeting_minuteTool = createTool({
  id: "query_meeting_minute",
  description: "Query MeetingMinute records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(MeetingMinuteSchema) }),
  execute: async () => { throw new Error("query_meeting_minute not implemented (US-014)"); },
});

export const traverse_meeting_minuteTool = createTool({
  id: "traverse_meeting_minute",
  description: "Traverse links from a MeetingMinute record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_meeting_minute not implemented (US-014)"); },
});

export const sample_meeting_minuteTool = createTool({
  id: "sample_meeting_minute",
  description: "Return up to N representative MeetingMinute records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(MeetingMinuteSchema) }),
  execute: async () => { throw new Error("sample_meeting_minute not implemented (US-014)"); },
});

export const read_meeting_minuteTool = createTool({
  id: "read_meeting_minute",
  description: "Read a single MeetingMinute record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: MeetingMinuteSchema.nullable() }),
  execute: async () => { throw new Error("read_meeting_minute not implemented (US-014)"); },
});

export const audit_meeting_minuteTool = createTool({
  id: "audit_meeting_minute",
  description: "Return recent audit entries scoped to MeetingMinute.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_meeting_minute not implemented (US-014)"); },
});

export const describe_member_contextTool = createTool({
  id: "describe_member_context",
  description: "Describe the MemberContext object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_member_context not implemented (US-014)"); },
});

export const query_member_contextTool = createTool({
  id: "query_member_context",
  description: "Query MemberContext records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(MemberContextSchema) }),
  execute: async () => { throw new Error("query_member_context not implemented (US-014)"); },
});

export const traverse_member_contextTool = createTool({
  id: "traverse_member_context",
  description: "Traverse links from a MemberContext record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_member_context not implemented (US-014)"); },
});

export const sample_member_contextTool = createTool({
  id: "sample_member_context",
  description: "Return up to N representative MemberContext records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(MemberContextSchema) }),
  execute: async () => { throw new Error("sample_member_context not implemented (US-014)"); },
});

export const read_member_contextTool = createTool({
  id: "read_member_context",
  description: "Read a single MemberContext record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: MemberContextSchema.nullable() }),
  execute: async () => { throw new Error("read_member_context not implemented (US-014)"); },
});

export const audit_member_contextTool = createTool({
  id: "audit_member_context",
  description: "Return recent audit entries scoped to MemberContext.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_member_context not implemented (US-014)"); },
});

export const describe_memberTool = createTool({
  id: "describe_member",
  description: "Describe the Member object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_member not implemented (US-014)"); },
});

export const query_memberTool = createTool({
  id: "query_member",
  description: "Query Member records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(MemberSchema) }),
  execute: async () => { throw new Error("query_member not implemented (US-014)"); },
});

export const traverse_memberTool = createTool({
  id: "traverse_member",
  description: "Traverse links from a Member record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_member not implemented (US-014)"); },
});

export const sample_memberTool = createTool({
  id: "sample_member",
  description: "Return up to N representative Member records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(MemberSchema) }),
  execute: async () => { throw new Error("sample_member not implemented (US-014)"); },
});

export const read_memberTool = createTool({
  id: "read_member",
  description: "Read a single Member record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: MemberSchema.nullable() }),
  execute: async () => { throw new Error("read_member not implemented (US-014)"); },
});

export const audit_memberTool = createTool({
  id: "audit_member",
  description: "Return recent audit entries scoped to Member.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_member not implemented (US-014)"); },
});

export const describe_notificationTool = createTool({
  id: "describe_notification",
  description: "Describe the Notification object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_notification not implemented (US-014)"); },
});

export const query_notificationTool = createTool({
  id: "query_notification",
  description: "Query Notification records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(NotificationSchema) }),
  execute: async () => { throw new Error("query_notification not implemented (US-014)"); },
});

export const traverse_notificationTool = createTool({
  id: "traverse_notification",
  description: "Traverse links from a Notification record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_notification not implemented (US-014)"); },
});

export const sample_notificationTool = createTool({
  id: "sample_notification",
  description: "Return up to N representative Notification records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(NotificationSchema) }),
  execute: async () => { throw new Error("sample_notification not implemented (US-014)"); },
});

export const read_notificationTool = createTool({
  id: "read_notification",
  description: "Read a single Notification record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: NotificationSchema.nullable() }),
  execute: async () => { throw new Error("read_notification not implemented (US-014)"); },
});

export const audit_notificationTool = createTool({
  id: "audit_notification",
  description: "Return recent audit entries scoped to Notification.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_notification not implemented (US-014)"); },
});

export const describe_roomTool = createTool({
  id: "describe_room",
  description: "Describe the Room object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_room not implemented (US-014)"); },
});

export const query_roomTool = createTool({
  id: "query_room",
  description: "Query Room records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(RoomSchema) }),
  execute: async () => { throw new Error("query_room not implemented (US-014)"); },
});

export const traverse_roomTool = createTool({
  id: "traverse_room",
  description: "Traverse links from a Room record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_room not implemented (US-014)"); },
});

export const sample_roomTool = createTool({
  id: "sample_room",
  description: "Return up to N representative Room records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(RoomSchema) }),
  execute: async () => { throw new Error("sample_room not implemented (US-014)"); },
});

export const read_roomTool = createTool({
  id: "read_room",
  description: "Read a single Room record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: RoomSchema.nullable() }),
  execute: async () => { throw new Error("read_room not implemented (US-014)"); },
});

export const audit_roomTool = createTool({
  id: "audit_room",
  description: "Return recent audit entries scoped to Room.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_room not implemented (US-014)"); },
});

export const describe_shiftTool = createTool({
  id: "describe_shift",
  description: "Describe the Shift object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_shift not implemented (US-014)"); },
});

export const query_shiftTool = createTool({
  id: "query_shift",
  description: "Query Shift records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(ShiftSchema) }),
  execute: async () => { throw new Error("query_shift not implemented (US-014)"); },
});

export const traverse_shiftTool = createTool({
  id: "traverse_shift",
  description: "Traverse links from a Shift record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_shift not implemented (US-014)"); },
});

export const sample_shiftTool = createTool({
  id: "sample_shift",
  description: "Return up to N representative Shift records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(ShiftSchema) }),
  execute: async () => { throw new Error("sample_shift not implemented (US-014)"); },
});

export const read_shiftTool = createTool({
  id: "read_shift",
  description: "Read a single Shift record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: ShiftSchema.nullable() }),
  execute: async () => { throw new Error("read_shift not implemented (US-014)"); },
});

export const audit_shiftTool = createTool({
  id: "audit_shift",
  description: "Return recent audit entries scoped to Shift.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_shift not implemented (US-014)"); },
});

export const describe_work_trade_agreementTool = createTool({
  id: "describe_work_trade_agreement",
  description: "Describe the WorkTradeAgreement object type (properties, links, permissions).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
  execute: async () => { throw new Error("describe_work_trade_agreement not implemented (US-014)"); },
});

export const query_work_trade_agreementTool = createTool({
  id: "query_work_trade_agreement",
  description: "Query WorkTradeAgreement records by an optional filter.",
  inputSchema: z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ results: z.array(WorkTradeAgreementSchema) }),
  execute: async () => { throw new Error("query_work_trade_agreement not implemented (US-014)"); },
});

export const traverse_work_trade_agreementTool = createTool({
  id: "traverse_work_trade_agreement",
  description: "Traverse links from a WorkTradeAgreement record.",
  inputSchema: z.object({
    id: z.string(),
    link: z.string().optional(),
  }),
  outputSchema: z.object({ linked: z.array(z.unknown()) }),
  execute: async () => { throw new Error("traverse_work_trade_agreement not implemented (US-014)"); },
});

export const sample_work_trade_agreementTool = createTool({
  id: "sample_work_trade_agreement",
  description: "Return up to N representative WorkTradeAgreement records.",
  inputSchema: z.object({
    n: z.number().int().positive().max(100).default(5),
  }),
  outputSchema: z.object({ samples: z.array(WorkTradeAgreementSchema) }),
  execute: async () => { throw new Error("sample_work_trade_agreement not implemented (US-014)"); },
});

export const read_work_trade_agreementTool = createTool({
  id: "read_work_trade_agreement",
  description: "Read a single WorkTradeAgreement record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: WorkTradeAgreementSchema.nullable() }),
  execute: async () => { throw new Error("read_work_trade_agreement not implemented (US-014)"); },
});

export const audit_work_trade_agreementTool = createTool({
  id: "audit_work_trade_agreement",
  description: "Return recent audit entries scoped to WorkTradeAgreement.",
  inputSchema: z.object({
    id: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  outputSchema: z.object({ entries: z.array(z.unknown()) }),
  execute: async () => { throw new Error("audit_work_trade_agreement not implemented (US-014)"); },
});

// === apply_action (discriminated union over action types) ===

export const applyActionInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change_tier"), params: ChangeTierParamsSchema }),
  z.object({ action: z.literal("check_in"), params: CheckInParamsSchema }),
  z.object({ action: z.literal("check_out"), params: CheckOutParamsSchema }),
  z.object({ action: z.literal("claim_shift"), params: ClaimShiftParamsSchema }),
  z.object({ action: z.literal("dismiss_blocker"), params: DismissBlockerParamsSchema }),
  z.object({ action: z.literal("flag_blocker"), params: FlagBlockerParamsSchema }),
  z.object({ action: z.literal("log_incident"), params: LogIncidentParamsSchema }),
  z.object({ action: z.literal("mark_notification_read"), params: MarkNotificationReadParamsSchema }),
  z.object({ action: z.literal("promote_to_steward"), params: PromoteToStewardParamsSchema }),
  z.object({ action: z.literal("resolve_blocker_with_custom"), params: ResolveBlockerWithCustomParamsSchema }),
  z.object({ action: z.literal("resolve_blocker_with_input"), params: ResolveBlockerWithInputParamsSchema }),
  z.object({ action: z.literal("resolve_blocker_with_pathway"), params: ResolveBlockerWithPathwayParamsSchema }),
  z.object({ action: z.literal("start_work_trade"), params: StartWorkTradeParamsSchema }),
]);

export const applyActionTool = createTool({
  id: "apply_action",
  description: "Apply a named action to mutate ontology state. Input is a discriminated union over the action types declared in the ontology.",
  inputSchema: applyActionInputSchema,
  outputSchema: z.object({
    ok: z.boolean(),
    created: z.object({ object_type: z.string().optional(), id: z.string().optional() }).optional(),
  }),
  execute: async () => { throw new Error("apply_action not implemented (US-027)"); },
});

export const tools = {
  "describe_agent_blocker": describe_agent_blockerTool,
  "query_agent_blocker": query_agent_blockerTool,
  "traverse_agent_blocker": traverse_agent_blockerTool,
  "sample_agent_blocker": sample_agent_blockerTool,
  "read_agent_blocker": read_agent_blockerTool,
  "audit_agent_blocker": audit_agent_blockerTool,
  "describe_bed": describe_bedTool,
  "query_bed": query_bedTool,
  "traverse_bed": traverse_bedTool,
  "sample_bed": sample_bedTool,
  "read_bed": read_bedTool,
  "audit_bed": audit_bedTool,
  "describe_booking": describe_bookingTool,
  "query_booking": query_bookingTool,
  "traverse_booking": traverse_bookingTool,
  "sample_booking": sample_bookingTool,
  "read_booking": read_bookingTool,
  "audit_booking": audit_bookingTool,
  "describe_event": describe_eventTool,
  "query_event": query_eventTool,
  "traverse_event": traverse_eventTool,
  "sample_event": sample_eventTool,
  "read_event": read_eventTool,
  "audit_event": audit_eventTool,
  "describe_guest": describe_guestTool,
  "query_guest": query_guestTool,
  "traverse_guest": traverse_guestTool,
  "sample_guest": sample_guestTool,
  "read_guest": read_guestTool,
  "audit_guest": audit_guestTool,
  "describe_incident_log": describe_incident_logTool,
  "query_incident_log": query_incident_logTool,
  "traverse_incident_log": traverse_incident_logTool,
  "sample_incident_log": sample_incident_logTool,
  "read_incident_log": read_incident_logTool,
  "audit_incident_log": audit_incident_logTool,
  "describe_meeting_minute": describe_meeting_minuteTool,
  "query_meeting_minute": query_meeting_minuteTool,
  "traverse_meeting_minute": traverse_meeting_minuteTool,
  "sample_meeting_minute": sample_meeting_minuteTool,
  "read_meeting_minute": read_meeting_minuteTool,
  "audit_meeting_minute": audit_meeting_minuteTool,
  "describe_member_context": describe_member_contextTool,
  "query_member_context": query_member_contextTool,
  "traverse_member_context": traverse_member_contextTool,
  "sample_member_context": sample_member_contextTool,
  "read_member_context": read_member_contextTool,
  "audit_member_context": audit_member_contextTool,
  "describe_member": describe_memberTool,
  "query_member": query_memberTool,
  "traverse_member": traverse_memberTool,
  "sample_member": sample_memberTool,
  "read_member": read_memberTool,
  "audit_member": audit_memberTool,
  "describe_notification": describe_notificationTool,
  "query_notification": query_notificationTool,
  "traverse_notification": traverse_notificationTool,
  "sample_notification": sample_notificationTool,
  "read_notification": read_notificationTool,
  "audit_notification": audit_notificationTool,
  "describe_room": describe_roomTool,
  "query_room": query_roomTool,
  "traverse_room": traverse_roomTool,
  "sample_room": sample_roomTool,
  "read_room": read_roomTool,
  "audit_room": audit_roomTool,
  "describe_shift": describe_shiftTool,
  "query_shift": query_shiftTool,
  "traverse_shift": traverse_shiftTool,
  "sample_shift": sample_shiftTool,
  "read_shift": read_shiftTool,
  "audit_shift": audit_shiftTool,
  "describe_work_trade_agreement": describe_work_trade_agreementTool,
  "query_work_trade_agreement": query_work_trade_agreementTool,
  "traverse_work_trade_agreement": traverse_work_trade_agreementTool,
  "sample_work_trade_agreement": sample_work_trade_agreementTool,
  "read_work_trade_agreement": read_work_trade_agreementTool,
  "audit_work_trade_agreement": audit_work_trade_agreementTool,
  "apply_action": applyActionTool,
} as const;
