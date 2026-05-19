// THIS FILE IS GENERATED. DO NOT EDIT.
// Source: lib/codegen/zod.ts — regenerate via the ontology codegen pipeline.

import { z } from "zod";

// === Object types ===

export const EventSchema = z.object({
  "id": z.uuid(),
  "title": z.string(),
  "starts_at": z.iso.datetime({ offset: true }),
  "location": z.string(),
  "description": z.string(),
  "created_at": z.iso.datetime({ offset: true }),
});
export type Event = z.infer<typeof EventSchema>;

export const MeetingMinuteSchema = z.object({
  "id": z.uuid(),
  "title": z.string(),
  "body": z.string(),
  "event_id": z.string(),
  "created_at": z.iso.datetime({ offset: true }),
});
export type MeetingMinute = z.infer<typeof MeetingMinuteSchema>;

export const MemberSchema = z.object({
  "id": z.uuid(),
  "full_name": z.string(),
  "email": z.email(),
  "joined_at": z.iso.date(),
  "tier": z.enum(["basic", "sustaining", "lifetime"]).default("basic"),
  "notes": z.string(),
  "user_id": z.string().optional(),
  "invite_code": z.string().optional(),
  "invite_expires_at": z.iso.datetime({ offset: true }).optional(),
});
export type Member = z.infer<typeof MemberSchema>;

export const NotificationSchema = z.object({
  "id": z.uuid(),
  "recipient_member_id": z.string(),
  "kind": z.string(),
  "title": z.string(),
  "body": z.string(),
  "link_url": z.string().optional(),
  "created_at": z.iso.datetime({ offset: true }),
  "read_at": z.iso.datetime({ offset: true }).optional(),
});
export type Notification = z.infer<typeof NotificationSchema>;

// === Link types (with properties) ===

export const AttendedLinkSchema = z.object({
  "attended_at": z.iso.datetime({ offset: true }),
  "role": z.enum(["attendee", "organizer", "speaker"]).default("attendee"),
});
export type AttendedLink = z.infer<typeof AttendedLinkSchema>;

// === Action parameter schemas ===

export const AddMeetingMinuteParamsSchema = z.object({
  "title": z.string(),
  "body": z.string(),
  "event": z.string(),
});
export type AddMeetingMinuteParams = z.infer<typeof AddMeetingMinuteParamsSchema>;

export const AddMemberParamsSchema = z.object({
  "full_name": z.string(),
  "email": z.email(),
  "tier": z.enum(["basic", "sustaining", "lifetime"]).default("basic"),
});
export type AddMemberParams = z.infer<typeof AddMemberParamsSchema>;

export const ChangeTierParamsSchema = z.object({
  "member": z.string(),
  "new_tier": z.enum(["basic", "sustaining", "lifetime"]),
});
export type ChangeTierParams = z.infer<typeof ChangeTierParamsSchema>;

export const DeleteMemberParamsSchema = z.object({
  "id": z.uuid(),
});
export type DeleteMemberParams = z.infer<typeof DeleteMemberParamsSchema>;

export const PromoteToStewardParamsSchema = z.object({
  "member": z.string(),
});
export type PromoteToStewardParams = z.infer<typeof PromoteToStewardParamsSchema>;

export const RecordAttendanceParamsSchema = z.object({
  "member": z.string(),
  "event": z.string(),
  "role": z.enum(["attendee", "organizer", "speaker"]).default("attendee"),
});
export type RecordAttendanceParams = z.infer<typeof RecordAttendanceParamsSchema>;

