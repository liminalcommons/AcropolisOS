// M4.4: resolve_blocker_with_input + resolve_blocker_with_custom tests.
// TDD coverage per spec lines 140-148:
//   - resolve_blocker_with_input validates payload against input_schema
//   - resolve_blocker_with_custom records action_type reference
//   - member_self enforcement: B cannot resolve A's blocker
//   - dismiss_blocker writes notification to actor (agent principal) with reason

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

const SEED_ROOT = path.resolve(__dirname, "..", "scenarios", "small-community", "ontology");
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
    phone: "555-0000",
    tier_role: "staff",
    started_at: "2026-01-01",
    notes: "",
  };
}

function makeBlocker(
  id: string,
  blockedActorId: string,
  overrides: Partial<AgentBlocker> = {},
): AgentBlocker {
  return {
    id,
    blocked_actor_id: blockedActorId,
    reason_kind: "missing_data",
    summary: "Need confirmation code",
    detail: "Agent needs the code",
    resolution_mode: "text_input",
    status: "open",
    created_at: new Date().toISOString(),
    ...overrides,
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

describe("resolve_blocker_with_input", () => {
  it("member can resolve their OWN open blocker with text_input mode (happy path)", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000010", memberA.userId);
    await db.objects.AgentBlocker.create(blocker);

    const result = await invokeAction({
      actionName: "resolve_blocker_with_input",
      params: {
        blocker_id: blocker.id,
        input_payload: JSON.stringify({ value: "confirmation-code-42" }),
      },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: true, blocker_id: blocker.id });
    const updated = await db.objects.AgentBlocker.findById(blocker.id);
    expect(updated?.status).toBe("resolved");
  });

  it("member B cannot resolve member A's blocker (cross-member deny)", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000011", memberA.userId);
    await db.objects.AgentBlocker.create(blocker);

    await expect(
      invokeAction({
        actionName: "resolve_blocker_with_input",
        params: {
          blocker_id: blocker.id,
          input_payload: JSON.stringify({ value: "hacked" }),
        },
        ctx: memberBCtx,
        ontology,
        functionsDir: FUNCTIONS_DIR,
        sideEffectAdapters: adapters,
      }),
    ).rejects.toThrow(/cannot invoke action/);
  });

  it("rejects non-JSON input_payload", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000012", memberA.userId);
    await db.objects.AgentBlocker.create(blocker);

    const result = await invokeAction({
      actionName: "resolve_blocker_with_input",
      params: {
        blocker_id: blocker.id,
        input_payload: "not-json",
      },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid_json" });
  });

  it("rejects already-resolved blocker (not_open)", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000013", memberA.userId, {
      status: "resolved",
    });
    await db.objects.AgentBlocker.create(blocker);

    const result = await invokeAction({
      actionName: "resolve_blocker_with_input",
      params: {
        blocker_id: blocker.id,
        input_payload: JSON.stringify({ value: "late" }),
      },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: false, reason: "not_open" });
  });

  it("writes agent_unblocked notification to the resolving actor", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000014", memberA.userId);
    await db.objects.AgentBlocker.create(blocker);

    await invokeAction({
      actionName: "resolve_blocker_with_input",
      params: {
        blocker_id: blocker.id,
        input_payload: JSON.stringify({ code: "abc" }),
      },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    // The notification goes to the actor who resolved (so agent can pick up the thread).
    const notifs = await notifications.listForRecipient(memberA, memberA.userId);
    const unblocked = notifs.filter((n) => n.kind === "agent_unblocked");
    expect(unblocked).toHaveLength(1);
  });
});

describe("resolve_blocker_with_custom", () => {
  it("member can resolve their OWN blocker with a custom action_invocation (happy path)", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000020", memberA.userId, {
      resolution_mode: "pathways",
    });
    await db.objects.AgentBlocker.create(blocker);

    const result = await invokeAction({
      actionName: "resolve_blocker_with_custom",
      params: {
        blocker_id: blocker.id,
        action_invocation: JSON.stringify({
          action_type: "change_tier",
          params: { member: memberA.userId, new_tier: "sustaining" },
        }),
      },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: true, blocker_id: blocker.id, action_type: "change_tier" });
    const updated = await db.objects.AgentBlocker.findById(blocker.id);
    expect(updated?.status).toBe("resolved");
  });

  it("member B cannot resolve member A's blocker with custom invocation (cross-member deny)", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000021", memberA.userId, {
      resolution_mode: "pathways",
    });
    await db.objects.AgentBlocker.create(blocker);

    await expect(
      invokeAction({
        actionName: "resolve_blocker_with_custom",
        params: {
          blocker_id: blocker.id,
          action_invocation: JSON.stringify({ action_type: "change_tier", params: {} }),
        },
        ctx: memberBCtx,
        ontology,
        functionsDir: FUNCTIONS_DIR,
        sideEffectAdapters: adapters,
      }),
    ).rejects.toThrow(/cannot invoke action/);
  });

  it("rejects non-JSON action_invocation", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000022", memberA.userId, {
      resolution_mode: "pathways",
    });
    await db.objects.AgentBlocker.create(blocker);

    const result = await invokeAction({
      actionName: "resolve_blocker_with_custom",
      params: {
        blocker_id: blocker.id,
        action_invocation: "not-json",
      },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid_json" });
  });

  it("rejects invocation missing action_type field", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000023", memberA.userId, {
      resolution_mode: "pathways",
    });
    await db.objects.AgentBlocker.create(blocker);

    const result = await invokeAction({
      actionName: "resolve_blocker_with_custom",
      params: {
        blocker_id: blocker.id,
        action_invocation: JSON.stringify({ params: {} }),
      },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    expect(result).toMatchObject({ ok: false, reason: "missing_action_type" });
  });

  it("writes agent_unblocked notification to the resolving actor", async () => {
    const blocker = makeBlocker("00000000-0000-4000-8001-000000000024", memberA.userId, {
      resolution_mode: "pathways",
    });
    await db.objects.AgentBlocker.create(blocker);

    await invokeAction({
      actionName: "resolve_blocker_with_custom",
      params: {
        blocker_id: blocker.id,
        action_invocation: JSON.stringify({ action_type: "change_tier", params: {} }),
      },
      ctx: memberACtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });

    const notifs = await notifications.listForRecipient(memberA, memberA.userId);
    const unblocked = notifs.filter((n) => n.kind === "agent_unblocked");
    expect(unblocked).toHaveLength(1);
  });
});
