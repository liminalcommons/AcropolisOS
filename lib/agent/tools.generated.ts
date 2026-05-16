// THIS FILE IS GENERATED. DO NOT EDIT.
// Source: lib/codegen/mastra-tools.ts — regenerate via the ontology codegen pipeline.

import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import {
  EventSchema,
  MeetingMinuteSchema,
  MemberSchema,
  AddMeetingMinuteParamsSchema,
  AddMemberParamsSchema,
  ChangeTierParamsSchema,
  RecordAttendanceParamsSchema,
} from "../ontology/types.generated";

// === READ tools (one per READ op × object type) ===

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

// === apply_action (discriminated union over action types) ===

export const applyActionInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_meeting_minute"), params: AddMeetingMinuteParamsSchema }),
  z.object({ action: z.literal("add_member"), params: AddMemberParamsSchema }),
  z.object({ action: z.literal("change_tier"), params: ChangeTierParamsSchema }),
  z.object({ action: z.literal("record_attendance"), params: RecordAttendanceParamsSchema }),
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
  "describe_event": describe_eventTool,
  "query_event": query_eventTool,
  "traverse_event": traverse_eventTool,
  "sample_event": sample_eventTool,
  "read_event": read_eventTool,
  "audit_event": audit_eventTool,
  "describe_meeting_minute": describe_meeting_minuteTool,
  "query_meeting_minute": query_meeting_minuteTool,
  "traverse_meeting_minute": traverse_meeting_minuteTool,
  "sample_meeting_minute": sample_meeting_minuteTool,
  "read_meeting_minute": read_meeting_minuteTool,
  "audit_meeting_minute": audit_meeting_minuteTool,
  "describe_member": describe_memberTool,
  "query_member": query_memberTool,
  "traverse_member": traverse_memberTool,
  "sample_member": sample_memberTool,
  "read_member": read_memberTool,
  "audit_member": audit_memberTool,
  "apply_action": applyActionTool,
} as const;
