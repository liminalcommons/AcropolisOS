// THIS FILE IS GENERATED. DO NOT EDIT.
// Source: lib/codegen/zod.ts — regenerate via the ontology codegen pipeline.

import { z } from "zod";

// === Object types ===

export const AgentBlockerSchema = z.object({
  "id": z.uuid(),
  "blocked_actor_id": z.string(),
  "reason_kind": z.enum(["approval", "confirmation", "ambiguity", "missing_data", "consent", "decision", "risky_action"]),
  "summary": z.string(),
  "detail": z.string(),
  "blocked_work_ref": z.string().optional(),
  "resolution_mode": z.enum(["pathways", "text_input", "confirm_binary"]).default("pathways"),
  "pathways": z.string().optional(),
  "input_schema": z.string().optional(),
  "confirm_action": z.string().optional(),
  "status": z.enum(["open", "resolved", "dismissed", "expired"]).default("open"),
  "created_at": z.iso.datetime({ offset: true }),
  "resolved_at": z.iso.datetime({ offset: true }).optional(),
  "resolved_by_action_audit_id": z.string().optional(),
  "resolved_via_pathway_id": z.uuid().optional(),
});
export type AgentBlocker = z.infer<typeof AgentBlockerSchema>;

export const BedSchema = z.object({
  "id": z.uuid(),
  "code": z.string().default("imported"),
  "room": z.string(),
  "is_bottom_bunk": z.boolean().default(true),
  "out_of_service": z.boolean().default(false),
  "notes": z.string().optional(),
});
export type Bed = z.infer<typeof BedSchema>;

export const BookingSchema = z.object({
  "id": z.uuid(),
  "label": z.string().default("Imported"),
  "guest": z.string(),
  "bed": z.string(),
  "from_date": z.iso.date(),
  "to_date": z.iso.date(),
  "rate_per_night": z.number().default(0),
  "currency": z.string().default("EUR"),
  "source": z.enum(["direct", "booking_com", "hostelworld", "hostelsclub", "work_trade", "walk_in"]).default("direct"),
  "status": z.enum(["confirmed", "checked_in", "completed", "cancelled", "no_show"]).default("confirmed"),
});
export type Booking = z.infer<typeof BookingSchema>;

export const EventSchema = z.object({
  "id": z.uuid(),
  "title": z.string().default("Imported event"),
  "starts_at": z.iso.datetime({ offset: true }),
  "duration_hours": z.number().default(2),
  "attendance_cap": z.number().optional(),
  "organizer": z.string(),
  "description": z.string().optional(),
  "status": z.enum(["scheduled", "in_progress", "completed", "cancelled"]).default("scheduled"),
});
export type Event = z.infer<typeof EventSchema>;

export const GuestSchema = z.object({
  "id": z.uuid(),
  "full_name": z.string(),
  "email": z.email(),
  "country": z.string().default("unknown"),
  "phone": z.string().default("unknown"),
  "arrived_at": z.iso.date(),
  "expected_departure": z.iso.date(),
  "current_status": z.enum(["booked", "checked_in", "checked_out", "no_show", "cancelled"]).default("booked"),
  "is_work_trader": z.boolean().default(false),
  "notes": z.string().optional(),
});
export type Guest = z.infer<typeof GuestSchema>;

export const IncidentLogSchema = z.object({
  "id": z.uuid(),
  "summary": z.string(),
  "body": z.string().optional(),
  "category": z.enum(["noise", "damage", "theft", "lost_key", "lockout", "medical", "dispute", "other"]),
  "severity": z.enum(["info", "low", "medium", "high", "critical"]).default("low"),
  "occurred_at": z.iso.datetime({ offset: true }),
  "reported_by": z.string().optional(),
  "resolved": z.boolean().default(false),
  "resolution_notes": z.string().optional(),
});
export type IncidentLog = z.infer<typeof IncidentLogSchema>;

export const MeetingMinuteSchema = z.object({
  "id": z.uuid(),
  "title": z.string(),
  "body": z.string(),
  "event_id": z.string(),
  "created_at": z.iso.datetime({ offset: true }),
});
export type MeetingMinute = z.infer<typeof MeetingMinuteSchema>;

export const MemberContextSchema = z.object({
  "id": z.uuid(),
  "member_id": z.string(),
  "pinned_widgets": z.string().default("[]"),
  "theme_pref": z.string().optional(),
  "created_at": z.iso.datetime({ offset: true }),
  "updated_at": z.iso.datetime({ offset: true }),
});
export type MemberContext = z.infer<typeof MemberContextSchema>;

export const MemberSchema = z.object({
  "id": z.uuid(),
  "full_name": z.string(),
  "email": z.email(),
  "phone": z.string().default("unknown"),
  "tier_role": z.enum(["work_trader", "staff", "supervisor", "manager"]).default("staff"),
  "started_at": z.iso.date(),
  "notes": z.string().optional(),
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

export const RoomSchema = z.object({
  "id": z.uuid(),
  "code": z.string().default("imported"),
  "kind": z.enum(["dorm_mixed", "dorm_female", "dorm_male", "private", "staff"]).default("dorm_mixed"),
  "capacity": z.number().default(0),
  "floor": z.number().optional(),
  "notes": z.string().optional(),
});
export type Room = z.infer<typeof RoomSchema>;

export const ShiftSchema = z.object({
  "id": z.uuid(),
  "label": z.string().default("Imported shift"),
  "kind": z.enum(["reception", "cleaning", "kitchen", "laundry", "breakfast", "night_audit", "social"]).default("reception"),
  "starts_at": z.iso.datetime({ offset: true }),
  "duration_hours": z.number().default(8),
  "claimed_by": z.string().optional(),
  "status": z.enum(["open", "claimed", "in_progress", "done", "missed"]).default("open"),
  "notes": z.string().optional(),
});
export type Shift = z.infer<typeof ShiftSchema>;

export const WorkTradeAgreementSchema = z.object({
  "id": z.uuid(),
  "label": z.string().default("Imported agreement"),
  "guest": z.string().optional(),
  "bed_comp": z.string(),
  "hours_per_week": z.number().default(20),
  "start_date": z.iso.date(),
  "end_date": z.iso.date(),
  "status": z.enum(["pending", "active", "completed", "terminated"]).default("pending"),
  "notes": z.string().optional(),
});
export type WorkTradeAgreement = z.infer<typeof WorkTradeAgreementSchema>;

// === Link types (with properties) ===

export const BookedIntoLinkSchema = z.object({
  "booking": z.string(),
});
export type BookedIntoLink = z.infer<typeof BookedIntoLinkSchema>;

export const AttendedLinkSchema = z.object({
  "attended_at": z.iso.datetime({ offset: true }),
  "role": z.enum(["attendee", "organizer", "speaker"]),
});
export type AttendedLink = z.infer<typeof AttendedLinkSchema>;

// === Action parameter schemas ===

export const ChangeTierParamsSchema = z.object({
  "member": z.string(),
  "new_tier": z.enum(["basic", "sustaining", "lifetime"]),
});
export type ChangeTierParams = z.infer<typeof ChangeTierParamsSchema>;

export const CheckInParamsSchema = z.object({
  "booking": z.string(),
});
export type CheckInParams = z.infer<typeof CheckInParamsSchema>;

export const CheckOutParamsSchema = z.object({
  "booking": z.string(),
});
export type CheckOutParams = z.infer<typeof CheckOutParamsSchema>;

export const ClaimShiftParamsSchema = z.object({
  "shift": z.string(),
});
export type ClaimShiftParams = z.infer<typeof ClaimShiftParamsSchema>;

export const DismissBlockerParamsSchema = z.object({
  "blocker_id": z.string(),
  "reason": z.string().optional(),
});
export type DismissBlockerParams = z.infer<typeof DismissBlockerParamsSchema>;

export const FlagBlockerParamsSchema = z.object({
  "blocked_actor_id": z.string(),
  "reason_kind": z.enum(["approval", "confirmation", "ambiguity", "missing_data", "consent", "decision", "risky_action"]),
  "summary": z.string(),
  "detail": z.string(),
  "blocked_work_ref": z.string().optional(),
  "resolution_mode": z.enum(["pathways", "text_input", "confirm_binary"]).default("pathways"),
  "pathways": z.string().optional(),
  "input_schema": z.string().optional(),
  "confirm_action": z.string().optional(),
});
export type FlagBlockerParams = z.infer<typeof FlagBlockerParamsSchema>;

export const LogIncidentParamsSchema = z.object({
  "summary": z.string(),
  "body": z.string().optional(),
  "category": z.enum(["noise", "damage", "theft", "lost_key", "lockout", "medical", "dispute", "other"]),
  "severity": z.enum(["info", "low", "medium", "high", "critical"]).default("low"),
});
export type LogIncidentParams = z.infer<typeof LogIncidentParamsSchema>;

export const MarkNotificationReadParamsSchema = z.object({
  "notification_id": z.string(),
});
export type MarkNotificationReadParams = z.infer<typeof MarkNotificationReadParamsSchema>;

export const PromoteToStewardParamsSchema = z.object({
  "member": z.string(),
});
export type PromoteToStewardParams = z.infer<typeof PromoteToStewardParamsSchema>;

export const ResolveBlockerWithCustomParamsSchema = z.object({
  "blocker_id": z.string(),
  "action_invocation": z.string(),
});
export type ResolveBlockerWithCustomParams = z.infer<typeof ResolveBlockerWithCustomParamsSchema>;

export const ResolveBlockerWithInputParamsSchema = z.object({
  "blocker_id": z.string(),
  "input_payload": z.string(),
});
export type ResolveBlockerWithInputParams = z.infer<typeof ResolveBlockerWithInputParamsSchema>;

export const ResolveBlockerWithPathwayParamsSchema = z.object({
  "blocker_id": z.string(),
  "pathway_id": z.uuid(),
});
export type ResolveBlockerWithPathwayParams = z.infer<typeof ResolveBlockerWithPathwayParamsSchema>;

export const StartWorkTradeParamsSchema = z.object({
  "guest": z.string(),
  "bed_comp": z.string(),
  "hours_per_week": z.number().default(20),
  "start_date": z.iso.date(),
  "end_date": z.iso.date(),
});
export type StartWorkTradeParams = z.infer<typeof StartWorkTradeParamsSchema>;

