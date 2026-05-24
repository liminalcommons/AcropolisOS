// M4.4: read-tools-me unit tests.
// TDD coverage per spec lines 140-148:
//   - query_member_context returns same widget shape /me renders
//   - member cannot query another member's context; steward can
//   - query_my_blockers is steward-only

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/ctx";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "@/lib/ontology/ctx";
import { loadOntology } from "@/lib/ontology/load";
import { InMemoryNotificationStore } from "@/lib/notifications/store";
import { InMemoryAuditStore } from "@/lib/audit/writer";
import type { Member, AgentBlocker } from "@/lib/ontology/types.generated";
import type { Ontology } from "@/lib/ontology/schema";
import { buildMeReadTools } from "./read-tools-me";

const SEED_ROOT = path.resolve(__dirname, "..", "..", "seed", "small-community");

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
  userId: "00000000-0000-4000-8000-0000000000cc",
  email: "stew@example.com",
  role: "steward",
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

let ontology: Ontology;
let db: OntologyStore;
let notifications: InMemoryNotificationStore;
let audit: InMemoryAuditStore;
let ctxA: OntologyCtx;
let ctxB: OntologyCtx;
let ctxSteward: OntologyCtx;

beforeEach(async () => {
  ontology = await loadOntology(SEED_ROOT);
  const permissions = buildObjectPermissionsMap(ontology);
  db = createInMemoryStore();
  notifications = new InMemoryNotificationStore();
  audit = new InMemoryAuditStore();

  ctxA = createCtx({ db, actor: memberA, permissions, notifications, audit });
  ctxB = createCtx({ db, actor: memberB, permissions, notifications, audit });
  ctxSteward = createCtx({ db, actor: steward, permissions, notifications, audit });

  await db.objects.Member.create(memberRow(memberA));
  await db.objects.Member.create(memberRow(memberB));
  await db.objects.Member.create(memberRow(steward));
});

describe("query_member_context", () => {
  it("returns MeBundle with widgets array — same shape /me renders", async () => {
    const tools = buildMeReadTools({ ctx: ctxA, actor: memberA, ontology });
    const result = await tools.query_member_context.execute!(
      {},
      {} as never,
    ) as Record<string, unknown>;

    // Must have member_id, rendered_at, widgets (the MeBundle shape)
    expect(result).toHaveProperty("member_id", memberA.userId);
    expect(result).toHaveProperty("rendered_at");
    expect(Array.isArray(result.widgets)).toBe(true);
    const widgets = result.widgets as Array<{ id: string; kind: string }>;
    // At minimum the agent_blockers + inbox_unread default widgets appear
    expect(widgets.some((w) => w.kind === "agent_blockers")).toBe(true);
    expect(widgets.some((w) => w.kind === "inbox_unread")).toBe(true);
  });

  it("defaults to actor's own member_id when none supplied", async () => {
    const tools = buildMeReadTools({ ctx: ctxA, actor: memberA, ontology });
    const result = await tools.query_member_context.execute!(
      {},
      {} as never,
    ) as { member_id: string };

    expect(result.member_id).toBe(memberA.userId);
  });

  it("member CANNOT query another member's context → forbidden error", async () => {
    const tools = buildMeReadTools({ ctx: ctxA, actor: memberA, ontology });
    const result = await tools.query_member_context.execute!(
      { member_id: memberB.userId },
      {} as never,
    ) as { error: string };

    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/forbidden/i);
  });

  it("steward CAN query any member's context", async () => {
    const tools = buildMeReadTools({ ctx: ctxSteward, actor: steward, ontology });
    const result = await tools.query_member_context.execute!(
      { member_id: memberA.userId },
      {} as never,
    ) as { member_id: string; widgets: unknown[] };

    expect(result.member_id).toBe(memberA.userId);
    expect(Array.isArray(result.widgets)).toBe(true);
  });

  it("agent_blockers widget lists open blockers for the member", async () => {
    // Create an open blocker for memberA
    const blocker: AgentBlocker = {
      id: "00000000-0000-4000-8001-000000000030",
      blocked_actor_id: memberA.userId,
      reason_kind: "confirmation",
      summary: "Test blocker",
      detail: "detail",
      resolution_mode: "confirm_binary",
      status: "open",
      created_at: new Date().toISOString(),
    };
    await db.objects.AgentBlocker.create(blocker);

    const tools = buildMeReadTools({ ctx: ctxA, actor: memberA, ontology });
    const result = await tools.query_member_context.execute!(
      {},
      {} as never,
    ) as { widgets: Array<{ kind: string; data: { blockers: unknown[] } }> };

    const blockersWidget = result.widgets.find((w) => w.kind === "agent_blockers");
    expect(blockersWidget).toBeDefined();
    expect(blockersWidget!.data.blockers).toHaveLength(1);
    expect((blockersWidget!.data.blockers[0] as { id: string }).id).toBe(blocker.id);
  });
});

describe("query_my_blockers", () => {
  it("steward gets grouped open blockers", async () => {
    // Create two blockers for two different members
    const b1: AgentBlocker = {
      id: "00000000-0000-4000-8001-000000000040",
      blocked_actor_id: memberA.userId,
      reason_kind: "confirmation",
      summary: "Blocker for A",
      detail: "detail",
      resolution_mode: "confirm_binary",
      status: "open",
      created_at: new Date().toISOString(),
    };
    const b2: AgentBlocker = {
      id: "00000000-0000-4000-8001-000000000041",
      blocked_actor_id: memberB.userId,
      reason_kind: "ambiguity",
      summary: "Blocker for B",
      detail: "detail",
      resolution_mode: "text_input",
      status: "open",
      created_at: new Date().toISOString(),
    };
    await db.objects.AgentBlocker.create(b1);
    await db.objects.AgentBlocker.create(b2);

    const tools = buildMeReadTools({ ctx: ctxSteward, actor: steward, ontology });
    const result = await tools.query_my_blockers.execute!(
      {},
      {} as never,
    ) as { count: number; by_actor: Record<string, unknown[]> };

    expect(result.count).toBe(2);
    expect(result.by_actor[memberA.userId]).toHaveLength(1);
    expect(result.by_actor[memberB.userId]).toHaveLength(1);
  });

  it("non-steward member gets forbidden error from query_my_blockers", async () => {
    const tools = buildMeReadTools({ ctx: ctxA, actor: memberA, ontology });
    const result = await tools.query_my_blockers.execute!(
      {},
      {} as never,
    ) as { error: string };

    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/forbidden/i);
  });
});
