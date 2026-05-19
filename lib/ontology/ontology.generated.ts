// THIS FILE IS GENERATED. DO NOT EDIT.
// Source: lib/codegen/zod.ts — regenerate via the ontology codegen pipeline.

import {
  EventSchema,
  MeetingMinuteSchema,
  MemberSchema,
  AttendedLinkSchema,
  AddMeetingMinuteParamsSchema,
  AddMemberParamsSchema,
  ChangeTierParamsSchema,
  DeleteMemberParamsSchema,
  RecordAttendanceParamsSchema,
  type Event,
  type MeetingMinute,
  type Member,
} from "./types.generated";

export {
  EventSchema,
  MeetingMinuteSchema,
  MemberSchema,
  AttendedLinkSchema,
  AddMeetingMinuteParamsSchema,
  AddMemberParamsSchema,
  ChangeTierParamsSchema,
  DeleteMemberParamsSchema,
  RecordAttendanceParamsSchema,
} from "./types.generated";
export type {
  Event,
  MeetingMinute,
  Member,
  AttendedLink,
  AddMeetingMinuteParams,
  AddMemberParams,
  ChangeTierParams,
  DeleteMemberParams,
  RecordAttendanceParams,
} from "./types.generated";

export type Ontology = {
  Event: Event;
  MeetingMinute: MeetingMinute;
  Member: Member;
};

export const OntologySchemas = {
  Event: EventSchema,
  MeetingMinute: MeetingMinuteSchema,
  Member: MemberSchema,
} as const;

export const LinkSchemas = {
  AttendedLink: AttendedLinkSchema,
} as const;

export const ActionParamSchemas = {
  AddMeetingMinuteParams: AddMeetingMinuteParamsSchema,
  AddMemberParams: AddMemberParamsSchema,
  ChangeTierParams: ChangeTierParamsSchema,
  DeleteMemberParams: DeleteMemberParamsSchema,
  RecordAttendanceParams: RecordAttendanceParamsSchema,
} as const;
