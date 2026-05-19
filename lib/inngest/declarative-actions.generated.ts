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
  "{\"properties\":{\"email\":{\"description\":\"Primary contact email\",\"type\":\"email\"},\"joined_at\":{\"description\":\"When the entity joined the community\",\"type\":\"date\"},\"created_at\":{\"description\":\"When this record was created\",\"type\":\"timestamp\"}},\"roles\":{\"member\":{\"description\":\"Anyone with a verified account in the community\"},\"steward\":{\"description\":\"Trusted operator able to record actions on others' behalf\"}},\"object_types\":{\"Event\":{\"description\":\"A community event open to members\",\"title_property\":\"title\",\"permissions\":{\"read\":[\"*\"],\"write\":[\"steward\"]},\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"title\":{\"type\":\"string\"},\"starts_at\":{\"type\":\"timestamp\"},\"location\":{\"type\":\"string\"},\"description\":{\"type\":\"string\"},\"created_at\":{\"ref\":\"created_at\"}}},\"MeetingMinute\":{\"description\":\"Notes captured from a community event\",\"title_property\":\"title\",\"permissions\":{\"read\":[\"*\"],\"write\":[\"steward\"]},\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"title\":{\"type\":\"string\"},\"body\":{\"type\":\"string\"},\"event_id\":{\"type\":\"ref\",\"target\":\"Event\"},\"created_at\":{\"ref\":\"created_at\"}}},\"Member\":{\"description\":\"A person belonging to the community\",\"title_property\":\"full_name\",\"permissions\":{\"read\":[\"steward\",\"member_self\"],\"write\":[\"steward\",\"member_self\"]},\"data_audit\":true,\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"full_name\":{\"type\":\"string\"},\"email\":{\"ref\":\"email\"},\"joined_at\":{\"ref\":\"joined_at\"},\"tier\":{\"default\":\"basic\",\"type\":\"enum\",\"values\":[\"basic\",\"sustaining\",\"lifetime\"]},\"notes\":{\"permissions\":{\"read\":[\"steward\"],\"write\":[\"steward\"]},\"type\":\"string\"},\"user_id\":{\"required\":false,\"type\":\"string\"},\"invite_code\":{\"permissions\":{\"read\":[\"steward\"],\"write\":[\"steward\"]},\"required\":false,\"type\":\"string\"},\"invite_expires_at\":{\"permissions\":{\"read\":[\"steward\"],\"write\":[\"steward\"]},\"required\":false,\"type\":\"timestamp\"}}},\"Notification\":{\"description\":\"An in-app inbox row delivered to a Member. Written by the notify_member\\nside-effect dispatcher whenever an action declares notify_member in its\\nside_effects list. Members read their own inbox at /inbox; stewards can\\nwrite rows on behalf of anyone (operational use).\\n\",\"title_property\":\"title\",\"permissions\":{\"read\":[\"steward\",\"member_self\"],\"write\":[\"steward\",\"member_self\"]},\"properties\":{\"id\":{\"primary_key\":true,\"type\":\"uuid\"},\"recipient_member_id\":{\"type\":\"ref\",\"target\":\"Member\"},\"kind\":{\"description\":\"Action type or category that produced this notification\",\"type\":\"string\"},\"title\":{\"type\":\"string\"},\"body\":{\"type\":\"string\"},\"link_url\":{\"required\":false,\"type\":\"string\"},\"created_at\":{\"ref\":\"created_at\"},\"read_at\":{\"required\":false,\"type\":\"timestamp\"}}}},\"link_types\":{\"attended\":{\"from\":\"Member\",\"to\":\"Event\",\"cardinality\":\"many-to-many\",\"description\":\"A member attended an event\",\"properties\":{\"attended_at\":{\"type\":\"timestamp\"},\"role\":{\"default\":\"attendee\",\"type\":\"enum\",\"values\":[\"attendee\",\"organizer\",\"speaker\"]}}},\"authored\":{\"from\":\"Member\",\"to\":\"MeetingMinute\",\"cardinality\":\"one-to-many\",\"description\":\"A member authored a meeting minute\"}},\"action_types\":{\"add_meeting_minute\":{\"description\":\"Capture meeting minutes for an event\",\"creates_object\":\"MeetingMinute\",\"parameters\":{\"title\":{\"required\":true,\"type\":\"string\"},\"body\":{\"required\":true,\"type\":\"string\"},\"event\":{\"required\":true,\"type\":\"ref\",\"target\":\"Event\"}},\"permissions\":[\"steward\",\"member\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\"]},\"add_member\":{\"description\":\"Add a new member to the community\",\"creates_object\":\"Member\",\"parameters\":{\"full_name\":{\"required\":true,\"type\":\"string\"},\"email\":{\"required\":true,\"type\":\"email\"},\"tier\":{\"default\":\"basic\",\"type\":\"enum\",\"values\":[\"basic\",\"sustaining\",\"lifetime\"]}},\"permissions\":[\"steward\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\"]},\"change_tier\":{\"description\":\"Move a member to a different tier\",\"function\":\"change-tier\",\"parameters\":{\"member\":{\"required\":true,\"type\":\"ref\",\"target\":\"Member\"},\"new_tier\":{\"required\":true,\"type\":\"enum\",\"values\":[\"basic\",\"sustaining\",\"lifetime\"]}},\"permissions\":[\"steward\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\",\"notify_member\"]},\"delete_member\":{\"description\":\"Permanently remove a member from the community (irreversible)\",\"deletes\":\"Member\",\"parameters\":{\"id\":{\"required\":true,\"type\":\"uuid\"}},\"permissions\":[\"steward\"],\"agent_policy\":\"confirm_if_unfamiliar\",\"side_effects\":[\"audit\"]},\"invite_member\":{\"description\":\"Generate a single-use invite code + expiry on a placeholder Member row\\nand fire notify_member with a /claim?code=<code> link. The invitee then\\nruns through /claim to create their UserRecord and link it back via\\nMember.user_id.\\n\\nFunction-backed because we need crypto.randomBytes + result.claim_url\\npass-through to the notify_member side-effect body. Refuses to re-invite\\na Member that already has user_id set (use a steward-only \\\"revoke +\\nre-invite\\\" path if/when that becomes a real workflow).\\n\",\"function\":\"invite-member\",\"parameters\":{\"member_id\":{\"required\":true,\"type\":\"ref\",\"target\":\"Member\"},\"expires_in_days\":{\"required\":false,\"default\":7,\"type\":\"integer\"}},\"permissions\":[\"steward\"],\"agent_policy\":\"auto_apply\",\"side_effects\":[\"audit\",\"notify_member\"]},\"promote_to_steward\":{\"description\":\"Promote a member to steward — composes change_tier(lifetime) and emits a\\nwelcome notification via the notify_member side-effect. Demonstrates\\naction-composition (M2.5): the function-backed handler calls another\\naction through ctx.actions.X, which records parent_action_audit_id back\\nto this row.\\n\",\"function\":\"promote-to-steward\",\"parameters\":{\"member\":{\"required\":true,\"type\":\"ref\",\"target\":\"Member\"}},\"permissions\":[\"steward\"],\"agent_policy\":\"always_confirm\",\"side_effects\":[\"audit\",\"notify_member\"]},\"record_attendance\":{\"description\":\"Record that a member attended an event\",\"creates_link\":\"attended\",\"parameters\":{\"member\":{\"required\":true,\"type\":\"ref\",\"target\":\"Member\"},\"event\":{\"required\":true,\"type\":\"ref\",\"target\":\"Event\"},\"role\":{\"default\":\"attendee\",\"type\":\"enum\",\"values\":[\"attendee\",\"organizer\",\"speaker\"]}},\"permissions\":[\"steward\",\"member_self\"],\"agent_policy\":\"auto_apply\",\"side_effects\":[\"audit\"]}}}",
) as Ontology;

export const actionAddMeetingMinute = inngest.createFunction(
  {
    id: "acropolisos-action-add_meeting_minute",
    name: "acropolisos action add_meeting_minute",
    triggers: [{ event: "acropolisos/action.add_meeting_minute" }],
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
        `acropolisos-action-add_meeting_minute: event.data.ctx is required (OntologyCtx must be passed in event payload)`,
      );
    }
    const params = payload.params;
    const parentAuditId = payload.parentAuditId;
    const sideEffectAdapters: SideEffectAdapters =
      (payload as { sideEffectAdapters?: SideEffectAdapters }).sideEffectAdapters ?? defaultAdapters;
    const pre = await step.run("audit-pre.add_meeting_minute", () =>
      auditPreInvocation({
        ctx,
        actionName: "add_meeting_minute",
        params,
        parentAuditId,
      }),
    );
    if (pre.kind === "replay") {
      return pre.priorResult;
    }
    await step.run("permission-check.add_meeting_minute", () =>
      enforceActionPermission({
        ontology,
        actionName: "add_meeting_minute",
        ctx,
      }),
    );
    const startedAt = Date.now();
    try {
      const result = await step.run("declarative.add_meeting_minute", () =>
        runDeclarativeAction({
          actionName: "add_meeting_minute",
          ontology,
          params,
          ctx,
        }),
      );
      await step.run("audit-post.add_meeting_minute", () =>
        auditPostInvocation({
          ctx,
          actionName: "add_meeting_minute",
          params,
          pendingAuditId: pre.pendingAuditId,
          idempotencyKey: pre.idempotencyKey,
          parentAuditId,
          status: "ok",
          durationMs: Date.now() - startedAt,
          result,
        }),
      );
      await step.run("side-effects.add_meeting_minute", () =>
        dispatchSideEffects({
          ctx,
          ontology,
          actionName: "add_meeting_minute",
          params,
          result,
          auditId: pre.pendingAuditId ?? undefined,
          adapters: sideEffectAdapters,
        }),
      );
      return result;
    } catch (err) {
      await step.run("audit-post.add_meeting_minute", () =>
        auditPostInvocation({
          ctx,
          actionName: "add_meeting_minute",
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

export const actionAddMember = inngest.createFunction(
  {
    id: "acropolisos-action-add_member",
    name: "acropolisos action add_member",
    triggers: [{ event: "acropolisos/action.add_member" }],
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
        `acropolisos-action-add_member: event.data.ctx is required (OntologyCtx must be passed in event payload)`,
      );
    }
    const params = payload.params;
    const parentAuditId = payload.parentAuditId;
    const sideEffectAdapters: SideEffectAdapters =
      (payload as { sideEffectAdapters?: SideEffectAdapters }).sideEffectAdapters ?? defaultAdapters;
    const pre = await step.run("audit-pre.add_member", () =>
      auditPreInvocation({
        ctx,
        actionName: "add_member",
        params,
        parentAuditId,
      }),
    );
    if (pre.kind === "replay") {
      return pre.priorResult;
    }
    await step.run("permission-check.add_member", () =>
      enforceActionPermission({
        ontology,
        actionName: "add_member",
        ctx,
      }),
    );
    const startedAt = Date.now();
    try {
      const result = await step.run("declarative.add_member", () =>
        runDeclarativeAction({
          actionName: "add_member",
          ontology,
          params,
          ctx,
        }),
      );
      await step.run("audit-post.add_member", () =>
        auditPostInvocation({
          ctx,
          actionName: "add_member",
          params,
          pendingAuditId: pre.pendingAuditId,
          idempotencyKey: pre.idempotencyKey,
          parentAuditId,
          status: "ok",
          durationMs: Date.now() - startedAt,
          result,
        }),
      );
      await step.run("side-effects.add_member", () =>
        dispatchSideEffects({
          ctx,
          ontology,
          actionName: "add_member",
          params,
          result,
          auditId: pre.pendingAuditId ?? undefined,
          adapters: sideEffectAdapters,
        }),
      );
      return result;
    } catch (err) {
      await step.run("audit-post.add_member", () =>
        auditPostInvocation({
          ctx,
          actionName: "add_member",
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

export const actionDeleteMember = inngest.createFunction(
  {
    id: "acropolisos-action-delete_member",
    name: "acropolisos action delete_member",
    triggers: [{ event: "acropolisos/action.delete_member" }],
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
        `acropolisos-action-delete_member: event.data.ctx is required (OntologyCtx must be passed in event payload)`,
      );
    }
    const params = payload.params;
    const parentAuditId = payload.parentAuditId;
    const sideEffectAdapters: SideEffectAdapters =
      (payload as { sideEffectAdapters?: SideEffectAdapters }).sideEffectAdapters ?? defaultAdapters;
    const pre = await step.run("audit-pre.delete_member", () =>
      auditPreInvocation({
        ctx,
        actionName: "delete_member",
        params,
        parentAuditId,
      }),
    );
    if (pre.kind === "replay") {
      return pre.priorResult;
    }
    await step.run("permission-check.delete_member", () =>
      enforceActionPermission({
        ontology,
        actionName: "delete_member",
        ctx,
      }),
    );
    const startedAt = Date.now();
    try {
      const result = await step.run("declarative.delete_member", () =>
        runDeclarativeAction({
          actionName: "delete_member",
          ontology,
          params,
          ctx,
        }),
      );
      await step.run("audit-post.delete_member", () =>
        auditPostInvocation({
          ctx,
          actionName: "delete_member",
          params,
          pendingAuditId: pre.pendingAuditId,
          idempotencyKey: pre.idempotencyKey,
          parentAuditId,
          status: "ok",
          durationMs: Date.now() - startedAt,
          result,
        }),
      );
      await step.run("side-effects.delete_member", () =>
        dispatchSideEffects({
          ctx,
          ontology,
          actionName: "delete_member",
          params,
          result,
          auditId: pre.pendingAuditId ?? undefined,
          adapters: sideEffectAdapters,
        }),
      );
      return result;
    } catch (err) {
      await step.run("audit-post.delete_member", () =>
        auditPostInvocation({
          ctx,
          actionName: "delete_member",
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

export const actionRecordAttendance = inngest.createFunction(
  {
    id: "acropolisos-action-record_attendance",
    name: "acropolisos action record_attendance",
    triggers: [{ event: "acropolisos/action.record_attendance" }],
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
        `acropolisos-action-record_attendance: event.data.ctx is required (OntologyCtx must be passed in event payload)`,
      );
    }
    const params = payload.params;
    const parentAuditId = payload.parentAuditId;
    const sideEffectAdapters: SideEffectAdapters =
      (payload as { sideEffectAdapters?: SideEffectAdapters }).sideEffectAdapters ?? defaultAdapters;
    const pre = await step.run("audit-pre.record_attendance", () =>
      auditPreInvocation({
        ctx,
        actionName: "record_attendance",
        params,
        parentAuditId,
      }),
    );
    if (pre.kind === "replay") {
      return pre.priorResult;
    }
    await step.run("permission-check.record_attendance", () =>
      enforceActionPermission({
        ontology,
        actionName: "record_attendance",
        ctx,
      }),
    );
    const startedAt = Date.now();
    try {
      const result = await step.run("declarative.record_attendance", () =>
        runDeclarativeAction({
          actionName: "record_attendance",
          ontology,
          params,
          ctx,
        }),
      );
      await step.run("audit-post.record_attendance", () =>
        auditPostInvocation({
          ctx,
          actionName: "record_attendance",
          params,
          pendingAuditId: pre.pendingAuditId,
          idempotencyKey: pre.idempotencyKey,
          parentAuditId,
          status: "ok",
          durationMs: Date.now() - startedAt,
          result,
        }),
      );
      await step.run("side-effects.record_attendance", () =>
        dispatchSideEffects({
          ctx,
          ontology,
          actionName: "record_attendance",
          params,
          result,
          auditId: pre.pendingAuditId ?? undefined,
          adapters: sideEffectAdapters,
        }),
      );
      return result;
    } catch (err) {
      await step.run("audit-post.record_attendance", () =>
        auditPostInvocation({
          ctx,
          actionName: "record_attendance",
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
  actionAddMeetingMinute,
  actionAddMember,
  actionDeleteMember,
  actionRecordAttendance,
] as const;
