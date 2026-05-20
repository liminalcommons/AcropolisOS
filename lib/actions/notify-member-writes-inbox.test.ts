// M4.1 step-1 RED: when the notify_member side-effect channel fires,
// it must persist an inbox row to NotificationStore for the actor's Member
// row in addition to firing the stdout adapter. The previously-shipped
// audit child row stays.
//
// Recipient resolution: notifications target `recipient_member_id`. In the
// existing member_self convention (lib/ontology/ctx.ts rowOwnedBy()), the
// Member row's id equals the actor.userId — the actor IS the member. The
// dispatcher therefore writes recipient_member_id = ctx.actor.userId when
// it fires the notify_member channel.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../ctx";
import {
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import { InMemoryAuditStore } from "../audit/writer";
import type { Ontology } from "../ontology/schema";
import {
  dispatchSideEffects,
  type SideEffectAdapters,
} from "./side-effects";
import { InMemoryNotificationStore } from "../notifications/store";

const member: Actor = {
  userId: "00000000-0000-4000-8000-00000000beef",
  email: "ada@example.com",
  role: "member",
  customRoles: [],
};

function makeOntology(): Ontology {
  return {
    properties: {},
    roles: { steward: {}, member: {} },
    object_types: {},
    link_types: {},
    action_types: {
      change_tier: {
        description: "Move a member to a different tier",
        function: "change-tier",
        permissions: ["steward"],
        agent_policy: "always_confirm",
        side_effects: ["audit", "notify_member"],
      },
    },
  };
}

let db: OntologyStore;
let audit: InMemoryAuditStore;
let notifications: InMemoryNotificationStore;
let ctx: OntologyCtx;
let adapters: SideEffectAdapters;

beforeEach(() => {
  db = createInMemoryStore();
  audit = new InMemoryAuditStore();
  notifications = new InMemoryNotificationStore();
  ctx = createCtx({ db, actor: member, audit, notifications });
  adapters = {
    sendMail: vi.fn(async () => undefined),
    postWebhook: vi.fn(async () => ({ status: 200 })),
    config: {},
  };
});

describe("notify_member side-effect writes an inbox row (M4.1)", () => {
  it("persists a notification row keyed to the actor (recipient_member_id = actor.userId)", async () => {
    await dispatchSideEffects({
      ctx,
      ontology: makeOntology(),
      actionName: "change_tier",
      params: { member: member.userId, new_tier: "lifetime" },
      result: { ok: true, new_tier: "lifetime", previous_tier: "basic" },
      auditId: "parent-audit-1",
      adapters,
    });

    // Pass member as actor — the store now enforces actor.userId === recipientMemberId (#27).
    const rows = await notifications.listForRecipient(member, member.userId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.recipient_member_id).toBe(member.userId);
    expect(row.kind).toBe("change_tier");
    expect(typeof row.title).toBe("string");
    expect(row.title.length).toBeGreaterThan(0);
    expect(typeof row.body).toBe("string");
    expect(row.body.length).toBeGreaterThan(0);
    expect(row.read_at).toBeNull();
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it("still fires the stdout/email adapter (notification row is additive, not replacing)", async () => {
    await dispatchSideEffects({
      ctx,
      ontology: makeOntology(),
      actionName: "change_tier",
      params: {},
      result: { ok: true },
      adapters,
    });
    expect(adapters.sendMail).toHaveBeenCalledTimes(1);
  });

  it("still writes the parent action_audit side_effect child row", async () => {
    await dispatchSideEffects({
      ctx,
      ontology: makeOntology(),
      actionName: "change_tier",
      params: {},
      result: { ok: true },
      auditId: "parent-audit-2",
      adapters,
    });
    const rows = await audit.listActionAudit();
    const child = rows.find(
      (r) =>
        r.subject_type === "side_effect" &&
        r.subject_id === "notify_member",
    );
    expect(child).toBeDefined();
    expect(child!.metadata.parent_action_audit_id).toBe("parent-audit-2");
  });

  it("does not write a notification row when actor is anonymous", async () => {
    const anonCtx = createCtx({
      db,
      actor: null,
      audit,
      notifications,
    });
    await dispatchSideEffects({
      ctx: anonCtx,
      ontology: makeOntology(),
      actionName: "change_tier",
      params: {},
      result: { ok: true },
      adapters,
    });
    // Pass member as actor — checking that anon actor wrote no rows for this recipient.
    const rows = await notifications.listForRecipient(member, member.userId);
    expect(rows).toHaveLength(0);
  });
});
