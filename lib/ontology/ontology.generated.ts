// THIS FILE IS GENERATED. DO NOT EDIT.
// Source: lib/codegen/zod.ts — regenerate via the ontology codegen pipeline.

import {
  EventSchema,
  MeetingMinuteSchema,
  MemberSchema,
  NotificationSchema,
  AttendedLinkSchema,
  AddMeetingMinuteParamsSchema,
  AddMemberParamsSchema,
  ChangeTierParamsSchema,
  DeleteMemberParamsSchema,
  InviteMemberParamsSchema,
  MarkNotificationReadParamsSchema,
  PromoteToStewardParamsSchema,
  RecordAttendanceParamsSchema,
  type Event,
  type MeetingMinute,
  type Member,
  type Notification,
} from "./types.generated";

export {
  EventSchema,
  MeetingMinuteSchema,
  MemberSchema,
  NotificationSchema,
  AttendedLinkSchema,
  AddMeetingMinuteParamsSchema,
  AddMemberParamsSchema,
  ChangeTierParamsSchema,
  DeleteMemberParamsSchema,
  InviteMemberParamsSchema,
  MarkNotificationReadParamsSchema,
  PromoteToStewardParamsSchema,
  RecordAttendanceParamsSchema,
} from "./types.generated";
export type {
  Event,
  MeetingMinute,
  Member,
  Notification,
  AttendedLink,
  AddMeetingMinuteParams,
  AddMemberParams,
  ChangeTierParams,
  DeleteMemberParams,
  InviteMemberParams,
  MarkNotificationReadParams,
  PromoteToStewardParams,
  RecordAttendanceParams,
} from "./types.generated";

export type Ontology = {
  Event: Event;
  MeetingMinute: MeetingMinute;
  Member: Member;
  Notification: Notification;
};

export const OntologySchemas = {
  Event: EventSchema,
  MeetingMinute: MeetingMinuteSchema,
  Member: MemberSchema,
  Notification: NotificationSchema,
} as const;

export const LinkSchemas = {
  AttendedLink: AttendedLinkSchema,
} as const;

export const ActionParamSchemas = {
  AddMeetingMinuteParams: AddMeetingMinuteParamsSchema,
  AddMemberParams: AddMemberParamsSchema,
  ChangeTierParams: ChangeTierParamsSchema,
  DeleteMemberParams: DeleteMemberParamsSchema,
  InviteMemberParams: InviteMemberParamsSchema,
  MarkNotificationReadParams: MarkNotificationReadParamsSchema,
  PromoteToStewardParams: PromoteToStewardParamsSchema,
  RecordAttendanceParams: RecordAttendanceParamsSchema,
} as const;
