// THIS FILE IS GENERATED. DO NOT EDIT.
// Source: lib/codegen/zod.ts — regenerate via the ontology codegen pipeline.

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
  BookedIntoLinkSchema,
  AttendedLinkSchema,
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
  type AgentBlocker,
  type Bed,
  type Booking,
  type Event,
  type Guest,
  type IncidentLog,
  type MeetingMinute,
  type MemberContext,
  type Member,
  type Notification,
  type Room,
  type Shift,
  type WorkTradeAgreement,
} from "./types.generated";

export {
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
  BookedIntoLinkSchema,
  AttendedLinkSchema,
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
} from "./types.generated";
export type {
  AgentBlocker,
  Bed,
  Booking,
  Event,
  Guest,
  IncidentLog,
  MeetingMinute,
  MemberContext,
  Member,
  Notification,
  Room,
  Shift,
  WorkTradeAgreement,
  BookedIntoLink,
  AttendedLink,
  ChangeTierParams,
  CheckInParams,
  CheckOutParams,
  ClaimShiftParams,
  DismissBlockerParams,
  FlagBlockerParams,
  LogIncidentParams,
  MarkNotificationReadParams,
  PromoteToStewardParams,
  ResolveBlockerWithCustomParams,
  ResolveBlockerWithInputParams,
  ResolveBlockerWithPathwayParams,
  StartWorkTradeParams,
} from "./types.generated";

export type Ontology = {
  AgentBlocker: AgentBlocker;
  Bed: Bed;
  Booking: Booking;
  Event: Event;
  Guest: Guest;
  IncidentLog: IncidentLog;
  MeetingMinute: MeetingMinute;
  MemberContext: MemberContext;
  Member: Member;
  Notification: Notification;
  Room: Room;
  Shift: Shift;
  WorkTradeAgreement: WorkTradeAgreement;
};

export const OntologySchemas = {
  AgentBlocker: AgentBlockerSchema,
  Bed: BedSchema,
  Booking: BookingSchema,
  Event: EventSchema,
  Guest: GuestSchema,
  IncidentLog: IncidentLogSchema,
  MeetingMinute: MeetingMinuteSchema,
  MemberContext: MemberContextSchema,
  Member: MemberSchema,
  Notification: NotificationSchema,
  Room: RoomSchema,
  Shift: ShiftSchema,
  WorkTradeAgreement: WorkTradeAgreementSchema,
} as const;

export const LinkSchemas = {
  BookedIntoLink: BookedIntoLinkSchema,
  AttendedLink: AttendedLinkSchema,
} as const;

export const ActionParamSchemas = {
  ChangeTierParams: ChangeTierParamsSchema,
  CheckInParams: CheckInParamsSchema,
  CheckOutParams: CheckOutParamsSchema,
  ClaimShiftParams: ClaimShiftParamsSchema,
  DismissBlockerParams: DismissBlockerParamsSchema,
  FlagBlockerParams: FlagBlockerParamsSchema,
  LogIncidentParams: LogIncidentParamsSchema,
  MarkNotificationReadParams: MarkNotificationReadParamsSchema,
  PromoteToStewardParams: PromoteToStewardParamsSchema,
  ResolveBlockerWithCustomParams: ResolveBlockerWithCustomParamsSchema,
  ResolveBlockerWithInputParams: ResolveBlockerWithInputParamsSchema,
  ResolveBlockerWithPathwayParams: ResolveBlockerWithPathwayParamsSchema,
  StartWorkTradeParams: StartWorkTradeParamsSchema,
} as const;
