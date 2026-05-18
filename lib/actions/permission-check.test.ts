// US-032: Permission enforcement in action middleware.
//
// The action layer must refuse to invoke a handler when the actor's role is
// not in the action's declared permissions. Rejection throws a PermissionError
// (specifically ActionPermissionError, which subclasses PermissionError so the
// callers can catch either) and records a rejection row in action_audit.

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../ctx";
import { loadOntology } from "../ontology/load";
import {
  createCtx,
  createInMemoryStore,
  PermissionError,
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import { InMemoryAuditStore } from "../audit/writer";
import type { Ontology } from "../ontology/schema";
import {
  ActionPermissionError,
  canActorInvokeAction,
  enforceActionPermission,
} from "./permission-check";

const steward: Actor = {
  userId: "u-steward",
  email: "s@example.com",
  role: "steward",
  customRoles: [],
};

const member: Actor = {
  userId: "u-member",
  email: "m@example.com",
  role: "member",
  customRoles: [],
};

const SEED_DIR = path.join(
  __dirname,
  "..",
  "..",
  "seed",
  "small-community",
);

let ontology: Ontology;
let db: OntologyStore;
let audit: InMemoryAuditStore;
let memberCtx: OntologyCtx;
let stewardCtx: OntologyCtx;

beforeEach(async () => {
  ontology = await loadOntology(SEED_DIR);
  db = createInMemoryStore();
  audit = new InMemoryAuditStore();
  memberCtx = createCtx({ db, actor: member, audit });
  stewardCtx = createCtx({ db, actor: steward, audit });
});

describe("canActorInvokeAction", () => {
  it("returns false for an action with steward-only permissions when actor is a member", () => {
    // add_member.permissions = ["steward"] in the seed
    expect(canActorInvokeAction(member, ontology, "add_member")).toBe(false);
  });

  it("returns true for a member when the action allows [steward, member]", () => {
    // add_meeting_minute.permissions = ["steward", "member"]
    expect(
      canActorInvokeAction(member, ontology, "add_meeting_minute"),
    ).toBe(true);
  });

  it("returns true for a steward against any seed action", () => {
    for (const name of Object.keys(ontology.action_types)) {
      expect(canActorInvokeAction(steward, ontology, name)).toBe(true);
    }
  });

  it("returns false for an unknown action", () => {
    expect(canActorInvokeAction(steward, ontology, "ghost")).toBe(false);
  });

  it("returns false for null/anonymous actor when permissions are non-empty", () => {
    expect(canActorInvokeAction(null, ontology, "add_member")).toBe(false);
  });
});

describe("enforceActionPermission — denial path", () => {
  it("throws ActionPermissionError (instanceof PermissionError) when member invokes a steward-only action", async () => {
    await expect(
      enforceActionPermission({
        ontology,
        actionName: "add_member",
        ctx: memberCtx,
      }),
    ).rejects.toBeInstanceOf(ActionPermissionError);

    await expect(
      enforceActionPermission({
        ontology,
        actionName: "add_member",
        ctx: memberCtx,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("attaches actionName + requiredPermissions to the thrown error", async () => {
    try {
      await enforceActionPermission({
        ontology,
        actionName: "add_member",
        ctx: memberCtx,
      });
      throw new Error("expected enforceActionPermission to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ActionPermissionError);
      const e = err as ActionPermissionError;
      expect(e.actionName).toBe("add_member");
      expect(e.operation).toBe("invoke");
      expect(e.actorId).toBe("u-member");
      expect(e.requiredPermissions).toEqual(["steward"]);
    }
  });

  it("writes a rejection row to action_audit when ctx.audit is wired", async () => {
    await expect(
      enforceActionPermission({
        ontology,
        actionName: "add_member",
        ctx: memberCtx,
      }),
    ).rejects.toBeInstanceOf(ActionPermissionError);

    const rows = await audit.listActionAudit();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actor).toBe("u-member");
    expect(row.actor_role).toBe("member");
    expect(row.subject_type).toBe("action");
    expect(row.subject_id).toBe("add_member");
    expect(row.before).toBeNull();
    expect(row.after).toBeNull();
    expect(row.metadata).toMatchObject({
      result: "rejected",
      reason: "permission_denied",
      required_permissions: ["steward"],
    });
  });

  it("does not throw when ctx.audit is absent (audit is best-effort)", async () => {
    const ctxNoAudit = createCtx({ db, actor: member });
    await expect(
      enforceActionPermission({
        ontology,
        actionName: "add_member",
        ctx: ctxNoAudit,
      }),
    ).rejects.toBeInstanceOf(ActionPermissionError);
    // no audit means no row to inspect — assertion is the absence of a
    // secondary error
  });

  it("throws ActionPermissionError for an anonymous actor against any guarded action", async () => {
    const anonCtx = createCtx({ db, actor: null, audit });
    await expect(
      enforceActionPermission({
        ontology,
        actionName: "add_meeting_minute",
        ctx: anonCtx,
      }),
    ).rejects.toBeInstanceOf(ActionPermissionError);
    const rows = await audit.listActionAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("<anonymous>");
    expect(rows[0].actor_role).toBe("<anonymous>");
  });
});

describe("enforceActionPermission — allow path", () => {
  it("returns silently for a steward invoking a steward-only action", async () => {
    await expect(
      enforceActionPermission({
        ontology,
        actionName: "add_member",
        ctx: stewardCtx,
      }),
    ).resolves.toBeUndefined();
    expect(await audit.listActionAudit()).toHaveLength(0);
  });

  it("returns silently for a member invoking a [steward, member] action", async () => {
    await expect(
      enforceActionPermission({
        ontology,
        actionName: "add_meeting_minute",
        ctx: memberCtx,
      }),
    ).resolves.toBeUndefined();
    expect(await audit.listActionAudit()).toHaveLength(0);
  });

  it("returns silently for an action that declares no permissions block (open by default)", async () => {
    // Synthetic action — no `permissions` field => unrestricted.
    const opened: Ontology = {
      ...ontology,
      action_types: {
        ...ontology.action_types,
        ping: {
          parameters: {},
          agent_policy: "auto_apply",
        },
      },
    };
    await expect(
      enforceActionPermission({
        ontology: opened,
        actionName: "ping",
        ctx: memberCtx,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("enforceActionPermission — unknown action", () => {
  it("throws ActionPermissionError for an action that is not in the ontology", async () => {
    await expect(
      enforceActionPermission({
        ontology,
        actionName: "ghost",
        ctx: stewardCtx,
      }),
    ).rejects.toBeInstanceOf(ActionPermissionError);
  });
});
