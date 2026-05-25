// THIS FILE IS GENERATED. DO NOT EDIT.
// Source: lib/codegen/inngest.ts — regenerate via the ontology codegen pipeline.

import { inngest } from "../inngest/client";
import { runDeclarativeAction } from "../actions/declarative";
import { enforceActionPermission } from "../actions/permission-check";
import {
  auditPreInvocation,
  auditPostInvocation,
} from "../actions/audit-middleware";
import {
  dispatchSideEffects,
  loadSideEffectConfigFromEnv,
  type SideEffectAdapters,
} from "../actions/side-effects";
import { resolveSideEffectAdapters } from "../actions/side-effects-runtime";
import type { Ontology } from "../ontology/schema";
import type { OntologyCtx } from "../ontology/ctx";

// US-028: side-effect adapters are resolved once per module — production
// wires SMTP/Resend + fetch; tests can override via payload.sideEffectAdapters.
const defaultAdapters: SideEffectAdapters = resolveSideEffectAdapters(
  loadSideEffectConfigFromEnv(process.env),
);

const ontology: Ontology = JSON.parse(
  "{\"properties\":{\"email\":{\"description\":\"Primary contact email\",\"type\":\"email\"},\"created_at\":{\"description\":\"When this record was created\",\"type\":\"timestamp\"},\"country\":{\"description\":\"ISO 3166-1 alpha-2 country code\",\"type\":\"string\"},\"phone\":{\"description\":\"International phone number\",\"required\":false,\"type\":\"string\"}},\"roles\":{\"member\":{\"description\":\"Any verified account (staff or work-trader with login access)\"},\"steward\":{\"description\":\"Front-desk + supervisor; can check guests in/out and log incidents\"},\"manager\":{\"description\":\"Full write access; sets rates, signs work-trade agreements\"}},\"object_types\":{\"AgentBlocker\":{\"description\":\"Typed escalation from the agent to a specific human. Written by\\nthe flag_blocker action only — humans never edit the row directly\\n(they resolve via the resolve_blocker action or dismiss_blocker).\\n\",\"title_property\":\"summary\",\"permissions\":{\"read\":[\"steward\",\"member_self\"],\"write\":[\"steward\",\"member_self\"]},\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"blocked_actor_id\":{\"type\":\"ref\",\"target\":\"Member\"},\"reason_kind\":{\"type\":\"enum\",\"values\":[\"approval\",\"confirmation\",\"ambiguity\",\"missing_data\",\"consent\",\"decision\",\"risky_action\"]},\"summary\":{\"description\":\"One-line human-readable headline.\",\"type\":\"string\"},\"detail\":{\"description\":\"Agent's full reasoning / context.\",\"type\":\"string\"},\"blocked_work_ref\":{\"description\":\"Free-form handle to the workstream — chat session id, proposal id,\\naction_audit id. Attribution anchor across agent restarts.\\n\",\"required\":false,\"type\":\"string\"},\"resolution_mode\":{\"description\":\"Drives the widget UI shape:\\n- pathways: agent's N curated paths forward\\n- text_input: human supplies missing data\\n- confirm_binary: yes/no on a single proposed action\\n\",\"default\":\"pathways\",\"type\":\"enum\",\"values\":[\"pathways\",\"text_input\",\"confirm_binary\"]},\"pathways\":{\"description\":\"JSON array (present when resolution_mode = pathways). Each element:\\n{ id, label, rationale, action: { type, params }, reversibility: easy|moderate|permanent }.\\nN >= 1, <= 5. DB column is jsonb.\\n\",\"required\":false,\"type\":\"string\"},\"input_schema\":{\"description\":\"JSON object (present when resolution_mode = text_input).\\n{ kind: 'string'|'number'|'date'|'object_ref', target_type?, prompt: string }.\\nDB column is jsonb.\\n\",\"required\":false,\"type\":\"string\"},\"confirm_action\":{\"description\":\"JSON object (present when resolution_mode = confirm_binary).\\n{ label: string, action: { type, params } }. DB column is jsonb.\\n\",\"required\":false,\"type\":\"string\"},\"status\":{\"default\":\"open\",\"type\":\"enum\",\"values\":[\"open\",\"resolved\",\"dismissed\",\"expired\"]},\"created_at\":{\"ref\":\"created_at\"},\"resolved_at\":{\"required\":false,\"type\":\"timestamp\"},\"resolved_by_action_audit_id\":{\"description\":\"action_audit.id of the unblocking action invocation.\",\"required\":false,\"type\":\"string\"},\"resolved_via_pathway_id\":{\"description\":\"Which pathway the human picked (if any). Training signal for\\npathway preference by situation kind.\\n\",\"required\":false,\"type\":\"uuid\"}}},\"Bed\":{\"description\":\"A specific bed in a room\",\"title_property\":\"code\",\"permissions\":{\"read\":[\"*\"],\"write\":[\"manager\"]},\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"code\":{\"description\":\"e.g. \\\"D3-A2\\\" (Dorm 3, bunk A, bed 2)\",\"type\":\"string\"},\"room\":{\"type\":\"ref\",\"target\":\"Room\"},\"is_bottom_bunk\":{\"default\":true,\"type\":\"boolean\"},\"out_of_service\":{\"default\":false,\"type\":\"boolean\"},\"notes\":{\"required\":false,\"type\":\"string\"}}},\"Booking\":{\"description\":\"A guest's booking into a specific bed for a date range\",\"title_property\":\"label\",\"permissions\":{\"read\":[\"steward\",\"manager\"],\"write\":[\"steward\",\"manager\"]},\"data_audit\":true,\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"label\":{\"description\":\"Short label, e.g. \\\"Lena Petrov / D3-A2 / Jun 3-7\\\"\",\"type\":\"string\"},\"guest\":{\"type\":\"ref\",\"target\":\"Guest\"},\"bed\":{\"type\":\"ref\",\"target\":\"Bed\"},\"from_date\":{\"type\":\"date\"},\"to_date\":{\"type\":\"date\"},\"rate_per_night\":{\"description\":\"0 if work-trade\",\"type\":\"decimal\"},\"currency\":{\"default\":\"EUR\",\"type\":\"string\"},\"source\":{\"default\":\"direct\",\"type\":\"enum\",\"values\":[\"direct\",\"booking_com\",\"hostelworld\",\"hostelsclub\",\"work_trade\",\"walk_in\"]},\"status\":{\"default\":\"confirmed\",\"type\":\"enum\",\"values\":[\"confirmed\",\"checked_in\",\"completed\",\"cancelled\",\"no_show\"]}}},\"Event\":{\"description\":\"Hostel social event (movie night, walking tour, dinner)\",\"title_property\":\"title\",\"permissions\":{\"read\":[\"*\"],\"write\":[\"steward\",\"manager\"]},\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"title\":{\"type\":\"string\"},\"starts_at\":{\"type\":\"timestamp\"},\"duration_hours\":{\"default\":2,\"type\":\"decimal\"},\"attendance_cap\":{\"required\":false,\"type\":\"decimal\"},\"organizer\":{\"type\":\"ref\",\"target\":\"Member\"},\"description\":{\"required\":false,\"type\":\"string\"},\"status\":{\"default\":\"scheduled\",\"type\":\"enum\",\"values\":[\"scheduled\",\"in_progress\",\"completed\",\"cancelled\"]}}},\"Guest\":{\"description\":\"Anyone staying at the hostel — paid, work-trade, or visitor\",\"title_property\":\"full_name\",\"permissions\":{\"read\":[\"steward\",\"manager\"],\"write\":[\"steward\",\"manager\"]},\"data_audit\":true,\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"full_name\":{\"type\":\"string\"},\"email\":{\"ref\":\"email\"},\"country\":{\"ref\":\"country\"},\"phone\":{\"ref\":\"phone\"},\"arrived_at\":{\"type\":\"date\"},\"expected_departure\":{\"type\":\"date\"},\"current_status\":{\"default\":\"booked\",\"type\":\"enum\",\"values\":[\"booked\",\"checked_in\",\"checked_out\",\"no_show\",\"cancelled\"]},\"is_work_trader\":{\"default\":false,\"type\":\"boolean\"},\"notes\":{\"permissions\":{\"read\":[\"steward\",\"manager\"],\"write\":[\"steward\",\"manager\"]},\"required\":false,\"type\":\"string\"}}},\"IncidentLog\":{\"description\":\"A logged incident (noise, damage, lost key, medical, etc.)\",\"title_property\":\"summary\",\"permissions\":{\"read\":[\"steward\",\"manager\"],\"write\":[\"steward\",\"manager\"]},\"data_audit\":true,\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"summary\":{\"type\":\"string\"},\"body\":{\"required\":false,\"type\":\"string\"},\"category\":{\"type\":\"enum\",\"values\":[\"noise\",\"damage\",\"theft\",\"lost_key\",\"lockout\",\"medical\",\"dispute\",\"other\"]},\"severity\":{\"default\":\"low\",\"type\":\"enum\",\"values\":[\"info\",\"low\",\"medium\",\"high\",\"critical\"]},\"occurred_at\":{\"type\":\"timestamp\"},\"reported_by\":{\"type\":\"ref\",\"target\":\"Member\"},\"resolved\":{\"default\":false,\"type\":\"boolean\"},\"resolution_notes\":{\"required\":false,\"type\":\"string\"}}},\"MeetingMinute\":{\"description\":\"Notes captured from a community event\",\"title_property\":\"title\",\"permissions\":{\"read\":[\"*\"],\"write\":[\"steward\"]},\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"title\":{\"type\":\"string\"},\"body\":{\"type\":\"string\"},\"event_id\":{\"type\":\"ref\",\"target\":\"Event\"},\"created_at\":{\"ref\":\"created_at\"}}},\"MemberContext\":{\"description\":\"One row per Member; auto-created on first /me visit or first\\nquery_member_context call. Holds the member's `pinned_widgets`\\nlayered on top of the always-on default widget set.\\n\",\"title_property\":\"id\",\"permissions\":{\"read\":[\"steward\",\"member_self\"],\"write\":[\"steward\",\"member_self\"]},\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"member_id\":{\"type\":\"ref\",\"target\":\"Member\"},\"pinned_widgets\":{\"description\":\"JSON array of { id, kind, config } widget descriptors appended\\nafter the default widget set in /me render order. DB column is jsonb.\\n\",\"default\":\"[]\",\"type\":\"string\"},\"theme_pref\":{\"description\":\"JSON-encoded TokenSet (theme palette) for this member. Null = base\\npalette. UI preference only; never affects the world-model.\\n\",\"required\":false,\"type\":\"string\"},\"created_at\":{\"ref\":\"created_at\"},\"updated_at\":{\"description\":\"When pinned_widgets was last modified\",\"type\":\"timestamp\"}}},\"Member\":{\"description\":\"Staff or work-trader with a verified login account\",\"title_property\":\"full_name\",\"permissions\":{\"read\":[\"*\"],\"write\":[\"manager\",\"member_self\"]},\"data_audit\":true,\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"full_name\":{\"type\":\"string\"},\"email\":{\"ref\":\"email\"},\"phone\":{\"ref\":\"phone\"},\"tier_role\":{\"default\":\"staff\",\"type\":\"enum\",\"values\":[\"work_trader\",\"staff\",\"supervisor\",\"manager\"]},\"started_at\":{\"type\":\"date\"},\"notes\":{\"permissions\":{\"read\":[\"manager\"],\"write\":[\"manager\"]},\"required\":false,\"type\":\"string\"}}},\"Notification\":{\"description\":\"An in-app inbox row delivered to a Member. Written by the notify_member\\nside-effect dispatcher whenever an action declares notify_member in its\\nside_effects list. Members read their own inbox at /inbox; stewards can\\nwrite rows on behalf of anyone (operational use).\\n\",\"title_property\":\"title\",\"permissions\":{\"read\":[\"steward\",\"member_self\"],\"write\":[\"steward\",\"member_self\"]},\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"recipient_member_id\":{\"type\":\"ref\",\"target\":\"Member\"},\"kind\":{\"description\":\"Action type or category that produced this notification\",\"type\":\"string\"},\"title\":{\"type\":\"string\"},\"body\":{\"type\":\"string\"},\"link_url\":{\"required\":false,\"type\":\"string\"},\"created_at\":{\"ref\":\"created_at\"},\"read_at\":{\"required\":false,\"type\":\"timestamp\"}}},\"Room\":{\"description\":\"A physical room at the hostel\",\"title_property\":\"code\",\"permissions\":{\"read\":[\"*\"],\"write\":[\"manager\"]},\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"code\":{\"description\":\"Short code, e.g. \\\"D3\\\" or \\\"P5\\\"\",\"type\":\"string\"},\"kind\":{\"type\":\"enum\",\"values\":[\"dorm_mixed\",\"dorm_female\",\"dorm_male\",\"private\",\"staff\"]},\"capacity\":{\"type\":\"decimal\"},\"floor\":{\"required\":false,\"type\":\"decimal\"},\"notes\":{\"required\":false,\"type\":\"string\"}}},\"Shift\":{\"description\":\"A scheduled work slot (reception, cleaning, kitchen, etc.)\",\"title_property\":\"label\",\"permissions\":{\"read\":[\"*\"],\"write\":[\"steward\",\"manager\"]},\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"label\":{\"type\":\"string\"},\"kind\":{\"type\":\"enum\",\"values\":[\"reception\",\"cleaning\",\"kitchen\",\"laundry\",\"breakfast\",\"night_audit\",\"social\"]},\"starts_at\":{\"type\":\"timestamp\"},\"duration_hours\":{\"type\":\"decimal\"},\"claimed_by\":{\"required\":false,\"type\":\"ref\",\"target\":\"Member\"},\"status\":{\"default\":\"open\",\"type\":\"enum\",\"values\":[\"open\",\"claimed\",\"in_progress\",\"done\",\"missed\"]},\"notes\":{\"required\":false,\"type\":\"string\"}}},\"WorkTradeAgreement\":{\"description\":\"Agreement between hostel and a guest to exchange work for stay\",\"title_property\":\"label\",\"permissions\":{\"read\":[\"steward\",\"manager\"],\"write\":[\"manager\"]},\"data_audit\":true,\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"label\":{\"type\":\"string\"},\"guest\":{\"description\":\"May be null after graduation if the Guest record has been archived (see hm-004 / Anna Vogt pattern)\",\"required\":false,\"type\":\"ref\",\"target\":\"Guest\"},\"bed_comp\":{\"type\":\"ref\",\"target\":\"Bed\"},\"hours_per_week\":{\"default\":20,\"type\":\"decimal\"},\"start_date\":{\"type\":\"date\"},\"end_date\":{\"type\":\"date\"},\"status\":{\"default\":\"pending\",\"type\":\"enum\",\"values\":[\"pending\",\"active\",\"completed\",\"terminated\"]},\"notes\":{\"required\":false,\"type\":\"string\"}}}},\"link_types\":{\"booked_into\":{\"from\":\"Guest\",\"to\":\"Bed\",\"cardinality\":\"many-to-many\",\"description\":\"A guest is/was booked into a bed (carries booking ref + dates)\",\"properties\":{\"booking\":{\"type\":\"ref\",\"target\":\"Booking\"}}},\"staffed\":{\"from\":\"Member\",\"to\":\"Shift\",\"cardinality\":\"one-to-one\",\"description\":\"A member or work-trader is responsible for a shift\"},\"attended\":{\"from\":\"Member\",\"to\":\"Event\",\"cardinality\":\"many-to-many\",\"description\":\"A member attended an event\",\"properties\":{\"attended_at\":{\"type\":\"timestamp\"},\"role\":{\"type\":\"enum\",\"values\":[\"attendee\",\"organizer\",\"speaker\"]}}},\"attended_event\":{\"from\":\"Guest\",\"to\":\"Event\",\"cardinality\":\"many-to-many\",\"description\":\"A guest attended an event\"},\"involves\":{\"from\":\"IncidentLog\",\"to\":\"Guest\",\"cardinality\":\"many-to-many\",\"description\":\"Parties involved in an incident\"},\"trading_for\":{\"from\":\"WorkTradeAgreement\",\"to\":\"Bed\",\"cardinality\":\"one-to-one\",\"description\":\"Which bed the work-trader holds during the agreement (most beds have no active agreement)\",\"fk_optional\":true}},\"action_types\":{\"change_tier\":{\"description\":\"Move a member to a different tier\",\"function\":\"change-tier\",\"parameters\":{\"member\":{\"required\":true,\"type\":\"ref\",\"target\":\"Member\"},\"new_tier\":{\"required\":true,\"type\":\"enum\",\"values\":[\"basic\",\"sustaining\",\"lifetime\"]}},\"permissions\":[\"steward\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\",\"notify_member\"]},\"check_in\":{\"description\":\"Check a guest in for their booking\",\"function\":\"check-in\",\"parameters\":{\"booking\":{\"required\":true,\"type\":\"ref\",\"target\":\"Booking\"}},\"permissions\":[\"steward\",\"manager\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\"]},\"check_out\":{\"description\":\"Check a guest out at end of stay\",\"function\":\"check-out\",\"parameters\":{\"booking\":{\"required\":true,\"type\":\"ref\",\"target\":\"Booking\"}},\"permissions\":[\"steward\",\"manager\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\"]},\"claim_shift\":{\"description\":\"Self-assign to an open shift\",\"function\":\"claim-shift\",\"parameters\":{\"shift\":{\"required\":true,\"type\":\"ref\",\"target\":\"Shift\"}},\"permissions\":[\"member\",\"steward\",\"manager\"],\"agent_policy\":\"auto_apply\",\"side_effects\":[\"audit\"]},\"dismiss_blocker\":{\"description\":\"Blocked human dismisses a blocker they consider not-actually-blocking.\\nStatus flips to dismissed; agent principal is notified so it can\\nre-prompt or take a different approach next iteration.\\n\",\"function\":\"dismiss-blocker\",\"parameters\":{\"blocker_id\":{\"required\":true,\"type\":\"ref\",\"target\":\"AgentBlocker\"},\"reason\":{\"required\":false,\"type\":\"string\"}},\"permissions\":[\"member_self\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\",\"notify_member\"]},\"flag_blocker\":{\"description\":\"Agent-invoked: the agent has hit a wall only `blocked_actor_id` can\\nclear. Creates an AgentBlocker row and notifies the human.\\n\",\"function\":\"flag-blocker\",\"parameters\":{\"blocked_actor_id\":{\"required\":true,\"type\":\"ref\",\"target\":\"Member\"},\"reason_kind\":{\"required\":true,\"type\":\"enum\",\"values\":[\"approval\",\"confirmation\",\"ambiguity\",\"missing_data\",\"consent\",\"decision\",\"risky_action\"]},\"summary\":{\"required\":true,\"type\":\"string\"},\"detail\":{\"required\":true,\"type\":\"string\"},\"blocked_work_ref\":{\"required\":false,\"type\":\"string\"},\"resolution_mode\":{\"required\":false,\"default\":\"pathways\",\"type\":\"enum\",\"values\":[\"pathways\",\"text_input\",\"confirm_binary\"]},\"pathways\":{\"description\":\"JSON array of pathway objects. DB column is jsonb.\",\"required\":false,\"type\":\"string\"},\"input_schema\":{\"description\":\"JSON object for text_input resolution. DB column is jsonb.\",\"required\":false,\"type\":\"string\"},\"confirm_action\":{\"description\":\"JSON object for confirm_binary resolution. DB column is jsonb.\",\"required\":false,\"type\":\"string\"}},\"permissions\":[\"steward\"],\"agent_policy\":\"auto_apply\",\"side_effects\":[\"audit\",\"notify_member\"]},\"log_incident\":{\"description\":\"Log an incident at the hostel\",\"creates_object\":\"IncidentLog\",\"parameters\":{\"summary\":{\"required\":true,\"type\":\"string\"},\"body\":{\"required\":false,\"type\":\"string\"},\"category\":{\"required\":true,\"type\":\"enum\",\"values\":[\"noise\",\"damage\",\"theft\",\"lost_key\",\"lockout\",\"medical\",\"dispute\",\"other\"]},\"severity\":{\"default\":\"low\",\"type\":\"enum\",\"values\":[\"info\",\"low\",\"medium\",\"high\",\"critical\"]}},\"permissions\":[\"steward\",\"manager\"],\"agent_policy\":\"auto_apply\",\"side_effects\":[\"audit\",\"notify_steward\"]},\"mark_notification_read\":{\"description\":\"Mark a single Notification row as read by setting read_at = now().\\nmember_self: the actor must be the notification's recipient_member_id;\\na member acting on someone else's notification is denied. Stewards\\nhave unrestricted write per the Notification object's permissions.\\n\",\"function\":\"mark-notification-read\",\"parameters\":{\"notification_id\":{\"required\":true,\"type\":\"ref\",\"target\":\"Notification\"}},\"permissions\":[\"member_self\",\"steward\"],\"agent_policy\":\"auto_apply\",\"side_effects\":[\"audit\"]},\"promote_to_steward\":{\"description\":\"Promote a member to steward — composes change_tier(lifetime) and emits a\\nwelcome notification via the notify_member side-effect. Demonstrates\\naction-composition (M2.5): the function-backed handler calls another\\naction through ctx.actions.X, which records parent_action_audit_id back\\nto this row.\\n\",\"function\":\"promote-to-steward\",\"parameters\":{\"member\":{\"required\":true,\"type\":\"ref\",\"target\":\"Member\"}},\"permissions\":[\"steward\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\",\"notify_member\"]},\"resolve_blocker_with_custom\":{\"description\":\"Human picked \\\"Other (write your own)\\\" escape hatch. Lets the human\\ninvoke any action they're permitted to invoke as the resolution;\\nthat action_audit becomes resolved_by_action_audit_id.\\nmember_self: actor must be the blocker's blocked_actor_id.\\n\",\"function\":\"resolve-blocker-with-custom\",\"parameters\":{\"blocker_id\":{\"required\":true,\"type\":\"ref\",\"target\":\"AgentBlocker\"},\"action_invocation\":{\"description\":\"JSON-encoded { action_type, params }\",\"required\":true,\"type\":\"string\"}},\"permissions\":[\"member_self\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\",\"notify_member\"]},\"resolve_blocker_with_input\":{\"description\":\"Human supplied missing data. Middleware validates input against\\ninput_schema, fires the blocker's target action with input merged\\nin, and flips status to resolved.\\nmember_self: actor must be the blocker's blocked_actor_id.\\n\",\"function\":\"resolve-blocker-with-input\",\"parameters\":{\"blocker_id\":{\"required\":true,\"type\":\"ref\",\"target\":\"AgentBlocker\"},\"input_payload\":{\"description\":\"JSON-encoded input matching the blocker's input_schema\",\"required\":true,\"type\":\"string\"}},\"permissions\":[\"member_self\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\",\"notify_member\"]},\"resolve_blocker_with_pathway\":{\"description\":\"Human picked one of the agent's curated paths. Middleware fires the\\npathway's typed action, sets resolved_via_pathway_id, flips status,\\nand backfills resolved_by_action_audit_id.\\n\",\"function\":\"resolve-blocker-with-pathway\",\"parameters\":{\"blocker_id\":{\"required\":true,\"type\":\"ref\",\"target\":\"AgentBlocker\"},\"pathway_id\":{\"required\":true,\"type\":\"uuid\"}},\"permissions\":[\"member_self\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\",\"notify_member\"]},\"start_work_trade\":{\"description\":\"Promote a guest to an active work-trade agreement\",\"creates_object\":\"WorkTradeAgreement\",\"parameters\":{\"guest\":{\"required\":true,\"type\":\"ref\",\"target\":\"Guest\"},\"bed_comp\":{\"required\":true,\"type\":\"ref\",\"target\":\"Bed\"},\"hours_per_week\":{\"default\":20,\"type\":\"decimal\"},\"start_date\":{\"required\":true,\"type\":\"date\"},\"end_date\":{\"required\":true,\"type\":\"date\"}},\"permissions\":[\"manager\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\"]}}}",
) as Ontology;

export const actionLogIncident = inngest.createFunction(
  {
    id: "acropolisos-action-log_incident",
    name: "acropolisos action log_incident",
    triggers: [{ event: "acropolisos/action.log_incident" }],
  },
  async ({ event, step }) => {
    const payload = (event.data ?? {}) as {
      params?: unknown;
      ctx?: OntologyCtx;
      parentAuditId?: string;
    };
    const ctx = payload.ctx;
    if (!ctx) {
      throw new Error(
        `acropolisos-action-log_incident: event.data.ctx is required (OntologyCtx must be passed in event payload)`,
      );
    }
    const params = payload.params;
    const parentAuditId = payload.parentAuditId;
    const sideEffectAdapters: SideEffectAdapters =
      (payload as { sideEffectAdapters?: SideEffectAdapters }).sideEffectAdapters ?? defaultAdapters;
    const pre = await step.run("audit-pre.log_incident", () =>
      auditPreInvocation({
        ctx,
        actionName: "log_incident",
        params,
        parentAuditId,
      }),
    );
    if (pre.kind === "replay") {
      return pre.priorResult;
    }
    await step.run("permission-check.log_incident", () =>
      enforceActionPermission({
        ontology,
        actionName: "log_incident",
        ctx,
      }),
    );
    const startedAt = Date.now();
    try {
      const result = await step.run("declarative.log_incident", () =>
        runDeclarativeAction({
          actionName: "log_incident",
          ontology,
          params,
          ctx,
        }),
      );
      await step.run("audit-post.log_incident", () =>
        auditPostInvocation({
          ctx,
          actionName: "log_incident",
          params,
          pendingAuditId: pre.pendingAuditId,
          idempotencyKey: pre.idempotencyKey,
          parentAuditId,
          status: "ok",
          durationMs: Date.now() - startedAt,
          result,
        }),
      );
      await step.run("side-effects.log_incident", () =>
        dispatchSideEffects({
          ctx,
          ontology,
          actionName: "log_incident",
          params,
          result,
          auditId: pre.pendingAuditId ?? undefined,
          adapters: sideEffectAdapters,
        }),
      );
      return result;
    } catch (err) {
      await step.run("audit-post.log_incident", () =>
        auditPostInvocation({
          ctx,
          actionName: "log_incident",
          params,
          pendingAuditId: pre.pendingAuditId,
          idempotencyKey: pre.idempotencyKey,
          parentAuditId,
          status: "error",
          durationMs: Date.now() - startedAt,
          error: err,
        }),
      );
      throw err;
    }
  },
);

export const actionStartWorkTrade = inngest.createFunction(
  {
    id: "acropolisos-action-start_work_trade",
    name: "acropolisos action start_work_trade",
    triggers: [{ event: "acropolisos/action.start_work_trade" }],
  },
  async ({ event, step }) => {
    const payload = (event.data ?? {}) as {
      params?: unknown;
      ctx?: OntologyCtx;
      parentAuditId?: string;
    };
    const ctx = payload.ctx;
    if (!ctx) {
      throw new Error(
        `acropolisos-action-start_work_trade: event.data.ctx is required (OntologyCtx must be passed in event payload)`,
      );
    }
    const params = payload.params;
    const parentAuditId = payload.parentAuditId;
    const sideEffectAdapters: SideEffectAdapters =
      (payload as { sideEffectAdapters?: SideEffectAdapters }).sideEffectAdapters ?? defaultAdapters;
    const pre = await step.run("audit-pre.start_work_trade", () =>
      auditPreInvocation({
        ctx,
        actionName: "start_work_trade",
        params,
        parentAuditId,
      }),
    );
    if (pre.kind === "replay") {
      return pre.priorResult;
    }
    await step.run("permission-check.start_work_trade", () =>
      enforceActionPermission({
        ontology,
        actionName: "start_work_trade",
        ctx,
      }),
    );
    const startedAt = Date.now();
    try {
      const result = await step.run("declarative.start_work_trade", () =>
        runDeclarativeAction({
          actionName: "start_work_trade",
          ontology,
          params,
          ctx,
        }),
      );
      await step.run("audit-post.start_work_trade", () =>
        auditPostInvocation({
          ctx,
          actionName: "start_work_trade",
          params,
          pendingAuditId: pre.pendingAuditId,
          idempotencyKey: pre.idempotencyKey,
          parentAuditId,
          status: "ok",
          durationMs: Date.now() - startedAt,
          result,
        }),
      );
      await step.run("side-effects.start_work_trade", () =>
        dispatchSideEffects({
          ctx,
          ontology,
          actionName: "start_work_trade",
          params,
          result,
          auditId: pre.pendingAuditId ?? undefined,
          adapters: sideEffectAdapters,
        }),
      );
      return result;
    } catch (err) {
      await step.run("audit-post.start_work_trade", () =>
        auditPostInvocation({
          ctx,
          actionName: "start_work_trade",
          params,
          pendingAuditId: pre.pendingAuditId,
          idempotencyKey: pre.idempotencyKey,
          parentAuditId,
          status: "error",
          durationMs: Date.now() - startedAt,
          error: err,
        }),
      );
      throw err;
    }
  },
);

export const declarativeActionFunctions = [
  actionLogIncident,
  actionStartWorkTrade,
] as const;
