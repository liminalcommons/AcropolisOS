// M4.1 step-4: mark_notification_read action — happy path + member_self
// denial when actor is not the notification's recipient.
//
// Uses the REAL seed + REAL function file (mirror of composition.test.ts):
// proves the YAML registers the action, the function file discovers
// correctly via dynamic import, and the audit envelope hangs together.

import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../ctx";
import { invokeAction } from "./invoke";
import { loadOntology } from "../ontology/load";
import {
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import { InMemoryNotificationStore } from "../notifications/store";
import { InMemoryAuditStore } from "../audit/writer";
import type { Ontology } from "../ontology/schema";
import type { SideEffectAdapters } from "./side-effects";
import { ActionPermissionError } from "./permission-check";

const SEED_ROOT = path.resolve(__dirname, "..", "..", "scenarios", "small-community", "ontology");
const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");

const memberA: Actor = {
  userId: "00000000-0000-4000-8000-0000000000aa",
  email: "ada@example.com",
  role: "member",
  customRoles: [],
};

const memberB: Actor = {
  userId: "00000000-0000-4000-8000-0000000000bb",
  email: "bob@example.com",
  role: "member",
  customRoles: [],
};

const steward: Actor = {
  userId: "00000000-0000-4000-8000-00000000000s",
  email: "stew@example.com",
  role: "steward",
  customRoles: [],
};

let ontology: Ontology;
let db: OntologyStore;
let notifications: InMemoryNotificationStore;
let audit: InMemoryAuditStore;
let adapters: SideEffectAdapters;

function makeCtx(actor: Actor | null): OntologyCtx {
  return createCtx({ db, actor, audit, notifications });
}

beforeEach(async () => {
  ontology = await loadOntology(SEED_ROOT);
  db = createInMemoryStore();
  notifications = new InMemoryNotificationStore();
  audit = new InMemoryAuditStore();
  adapters = {
    sendMail: vi.fn(async () => undefined),
    postWebhook: vi.fn(async () => ({ status: 200 })),
    config: {},
  };
});

describe("mark_notification_read — real seed", () => {
  it("registers in the loaded ontology with member_self + steward permissions", () => {
    const def = ontology.action_types.mark_notification_read;
    expect(def).toBeDefined();
    expect(def?.function).toBe("mark-notification-read");
    expect(def?.permissions?.sort()).toEqual(["member_self", "steward"]);
  });

  it("HAPPY PATH: a member can mark their own notification read", async () => {
    const created = await notifications.create({
      recipient_member_id: memberA.userId,
      kind: "change_tier",
      title: "tier changed",
      body: "lifetime",
    });
    expect(created.read_at).toBeNull();

    const result = (await invokeAction({
      actionName: "mark_notification_read",
      params: { notification_id: created.id },
      ctx: makeCtx(memberA),
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    })) as { ok: boolean; read_at: string | null };
    expect(result.ok).toBe(true);
    expect(typeof result.read_at).toBe("string");

    const after = await notifications.findById(created.id);
    expect(after?.read_at).not.toBeNull();
  });

  it("DENIES member_self when actor is not the recipient", async () => {
    // M3.8 #34: ownership is verified at the permission layer before the
    // handler runs. A member invoking this action against another member's
    // notification throws ActionPermissionError — the handler is never reached
    // so no {ok: false, reason: "not_recipient"} is returned.
    const created = await notifications.create({
      recipient_member_id: memberA.userId,
      kind: "change_tier",
      title: "tier changed",
      body: "lifetime",
    });

    await expect(
      invokeAction({
        actionName: "mark_notification_read",
        params: { notification_id: created.id },
        ctx: makeCtx(memberB),
        ontology,
        functionsDir: FUNCTIONS_DIR,
        sideEffectAdapters: adapters,
      }),
    ).rejects.toBeInstanceOf(ActionPermissionError);

    const after = await notifications.findById(created.id);
    expect(after?.read_at).toBeNull();
  });

  it("STEWARD bypass: a steward may mark anyone's notification read", async () => {
    const created = await notifications.create({
      recipient_member_id: memberA.userId,
      kind: "promote_to_steward",
      title: "promoted",
      body: "lifetime",
    });
    const result = (await invokeAction({
      actionName: "mark_notification_read",
      params: { notification_id: created.id },
      ctx: makeCtx(steward),
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    const after = await notifications.findById(created.id);
    expect(after?.read_at).not.toBeNull();
  });

  it("throws ActionPermissionError when the notification does not exist (cannot verify ownership)", async () => {
    // M3.8 #34: ownership is verified at the permission layer. When the target
    // notification row is absent, the permission check cannot resolve ownership
    // and must deny. This throws ActionPermissionError before the handler runs,
    // so {ok: false, reason: "not_found"} is never returned.
    await expect(
      invokeAction({
        actionName: "mark_notification_read",
        params: { notification_id: "00000000-0000-4000-8000-00000000ffff" },
        ctx: makeCtx(memberA),
        ontology,
        functionsDir: FUNCTIONS_DIR,
        sideEffectAdapters: adapters,
      }),
    ).rejects.toBeInstanceOf(ActionPermissionError);
  });
});
