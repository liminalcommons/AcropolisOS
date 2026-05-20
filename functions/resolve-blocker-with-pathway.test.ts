// M4.3 step-4 RED: resolve_blocker_with_pathway + dismiss_blocker action tests.
// Tests: member can't resolve another's blocker, dismiss not undoable,
// flag_blocker rejected for member role, resolve_blocker_with_pathway requires open blocker.

import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/ctx";
import { invokeAction } from "@/lib/actions/invoke";
import { loadOntology } from "@/lib/ontology/load";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "@/lib/ontology/ctx";
import { InMemoryNotificationStore } from "@/lib/notifications/store";
import { InMemoryAuditStore } from "@/lib/audit/writer";
import type { Member, AgentBlocker } from "@/lib/ontology/types.generated";
import type { Ontology } from "@/lib/ontology/schema";
import type { SideEffectAdapters } from "@/lib/actions/side-effects";

const SEED_ROOT = path.resolve(__dirname, "..", "seed", "small-community");
const FUNCTIONS_DIR = path.resolve(__dirname, ".");

const steward: Actor = {
  userId: "00000000-0000-4000-8000-0000000000cc",
  email: "stew@example.com",
  role: "steward",
  customRoles: [],
};

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

function memberRow(actor: Actor): Member {
  return {
    id: actor.userId,
    full_name: "Test",
    email: actor.email,
    joined_at: "2026-01-01",
    tier: "basic",
    notes: "",
  };
}

function makeBlocker(
  id: string,
  blockedActorId: string,
  status: AgentBlocker["status"] = "open",
): AgentBlocker {
  return {
    id,
    blocked_actor_id: blockedActorId,
    reason_kind: "confirmation",
    summary: `Test blocker ${id}`,
    detail: "Agent needs confirmation",
    resolution_mode: "confirm_binary",
    status,
    created_at: new Date().toISOString(),
  };
}

let ontology: Ontology;
let db: OntologyStore;
let stewardCtx: OntologyCtx;
let memberACtx: OntologyCtx;
let memberBCtx: OntologyCtx;
let notifications: InMemoryNotificationStore;
let audit: InMemoryAuditStore;
let adapters: SideEffectAdapters;

beforeEach(async () => {
  ontology = await loadOntology(SEED_ROOT);
  const permissions = buildObjectPermissionsMap(ontology);
  db = createInMemoryStore();
  notifications = new InMemoryNotificationStore();
  audit = new InMemoryAuditStore();

  stewardCtx = createCtx({ db, actor: steward, permissions, notifications, audit });
  memberACtx = createCtx({ db, actor: memberA, permissions, notifications, audit });
  memberBCtx = createCtx({ db, actor: memberB, permissions, notifications, audit });

  await db.objects.Member.create(memberRow(steward));
  await db.objects.Member.create(memberRow(memberA));
  await db.objects.Member.create(memberRow(memberB));

  adapters = {
    sendMail: vi.fn(async () => undefined),
    postWebhook: vi.fn(async () => ({ status: 200 })),
    config: {},
  };
});

describe("resolve_blocker_with_pathway", () => {
  it("member can resolve their OWN open blocker (happy path)", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000001", memberA.userId);
    await db.objects.AgentBlocker.create(blocker);

    const result = await invokeAction({
      actionName: "resolve_blocker_with_pathway",
      params: {
        blocker_id: blocker.id,
        pathway_id: "00000000-0000-4000-8002-000000000001",
      },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: true });
    const updated = await db.objects.AgentBlocker.findById(blocker.id);
    expect(updated?.status).toBe("resolved");
    expect(updated?.resolved_via_pathway_id).toBe("00000000-0000-4000-8002-000000000001");
  });

  it("member A CANNOT resolve member B's blocker (cross-member deny)", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000002", memberB.userId);
    await db.objects.AgentBlocker.create(blocker);

    await expect(
      invokeAction({
        actionName: "resolve_blocker_with_pathway",
        params: { blocker_id: blocker.id, pathway_id: "00000000-0000-4000-8002-000000000002" },
        ctx: memberACtx,
        ontology,
        functionsDir: FUNCTIONS_DIR,
        sideEffectAdapters: adapters,
      }),
    ).rejects.toThrow(/cannot invoke action/);
  });

  it("permission denied for non-existent blocker (can't verify ownership → deny)", async () => {
    // member_self requires the blocker to exist + be owned by the actor.
    // A non-existent blocker_id means ownership can't be verified → permission denied.
    await expect(
      invokeAction({
        actionName: "resolve_blocker_with_pathway",
        params: {
          blocker_id: "00000000-0000-4000-8001-000000000099",
          pathway_id: "00000000-0000-4000-8002-000000000003",
        },
        ctx: memberACtx,
        ontology,
        functionsDir: FUNCTIONS_DIR,
        sideEffectAdapters: adapters,
      }),
    ).rejects.toThrow(/cannot invoke action/);
  });

  it("steward can resolve any blocker (even non-existent → not_found from handler)", async () => {
    // Steward bypasses ownership check; handler returns not_found.
    const result = await invokeAction({
      actionName: "resolve_blocker_with_pathway",
      params: {
        blocker_id: "00000000-0000-4000-8001-000000000099",
        pathway_id: "00000000-0000-4000-8002-000000000003",
      },
      ctx: stewardCtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("returns not_open when blocker is already resolved", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000003", memberA.userId, "resolved");
    await db.objects.AgentBlocker.create(blocker);

    const result = await invokeAction({
      actionName: "resolve_blocker_with_pathway",
      params: {
        blocker_id: blocker.id,
        pathway_id: "00000000-0000-4000-8002-000000000004",
      },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: false, reason: "not_open" });
  });
});

describe("dismiss_blocker", () => {
  it("member can dismiss their OWN open blocker", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000004", memberA.userId);
    await db.objects.AgentBlocker.create(blocker);

    const result = await invokeAction({
      actionName: "dismiss_blocker",
      params: { blocker_id: blocker.id, reason: "Not actually blocking" },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: true });
    const updated = await db.objects.AgentBlocker.findById(blocker.id);
    expect(updated?.status).toBe("dismissed");
  });

  it("member B CANNOT dismiss member A's blocker (cross-member deny)", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000005", memberA.userId);
    await db.objects.AgentBlocker.create(blocker);

    await expect(
      invokeAction({
        actionName: "dismiss_blocker",
        params: { blocker_id: blocker.id },
        ctx: memberBCtx,
        ontology,
        functionsDir: FUNCTIONS_DIR,
        sideEffectAdapters: adapters,
      }),
    ).rejects.toThrow(/cannot invoke action/);
  });

  it("dismiss is not undoable — dismissed blocker cannot be dismissed again", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000006", memberA.userId, "dismissed");
    await db.objects.AgentBlocker.create(blocker);

    const result = await invokeAction({
      actionName: "dismiss_blocker",
      params: { blocker_id: blocker.id },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: false, reason: "not_open" });
  });

  it("steward can dismiss any member's blocker", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000007", memberA.userId);
    await db.objects.AgentBlocker.create(blocker);

    const result = await invokeAction({
      actionName: "dismiss_blocker",
      params: { blocker_id: blocker.id, reason: "Steward override" },
      ctx: stewardCtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: true });
  });
});
