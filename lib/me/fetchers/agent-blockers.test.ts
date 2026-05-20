// M4.3 step-1 RED: agent_blockers fetcher tests.
// Tests verify: visibility (only own blockers), member_self permission,
// and open-only filter.

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/ctx";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
} from "@/lib/ontology/ctx";
import { loadOntology } from "@/lib/ontology/load";
import type { AgentBlocker, Member } from "@/lib/ontology/types.generated";
import { getAgentBlockers } from "./agent-blockers";

const SEED_ROOT = path.resolve(__dirname, "..", "..", "..", "seed", "small-community");

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

function makeMember(actor: Actor): Member {
  return {
    id: actor.userId,
    full_name: "Test Member",
    email: actor.email,
    joined_at: "2026-01-01",
    tier: "basic",
    notes: "",
  };
}

function makeBlocker(id: string, blockedActorId: string, status: AgentBlocker["status"] = "open"): AgentBlocker {
  return {
    id,
    blocked_actor_id: blockedActorId,
    reason_kind: "confirmation",
    summary: `Blocker ${id}`,
    detail: "Agent needs confirmation",
    resolution_mode: "pathways",
    status,
    created_at: new Date().toISOString(),
  };
}

let db: ReturnType<typeof createInMemoryStore>;
let ctxA: OntologyCtx;
let ctxB: OntologyCtx;
let ctxSteward: OntologyCtx;

beforeEach(async () => {
  db = createInMemoryStore();
  const ontology = await loadOntology(SEED_ROOT);
  const permissions = buildObjectPermissionsMap(ontology);
  ctxA = createCtx({ db, actor: memberA, permissions });
  ctxB = createCtx({ db, actor: memberB, permissions });
  ctxSteward = createCtx({ db, actor: steward, permissions });

  // Seed member rows (needed for ownership checks)
  await db.objects.Member.create(makeMember(memberA));
  await db.objects.Member.create(makeMember(memberB));
  await db.objects.Member.create(makeMember(steward));
});

describe("getAgentBlockers", () => {
  it("returns only open blockers for the requesting actor", async () => {
    const b1 = makeBlocker("00000000-0000-4000-8001-000000000001", memberA.userId, "open");
    const b2 = makeBlocker("00000000-0000-4000-8001-000000000002", memberA.userId, "resolved");
    const b3 = makeBlocker("00000000-0000-4000-8001-000000000003", memberB.userId, "open");
    await db.objects.AgentBlocker.create(b1);
    await db.objects.AgentBlocker.create(b2);
    await db.objects.AgentBlocker.create(b3);

    const bundle = await getAgentBlockers(ctxA, memberA.userId);
    expect(bundle.kind).toBe("agent_blockers");
    expect(bundle.data.blockers).toHaveLength(1);
    expect(bundle.data.blockers[0].id).toBe(b1.id);
  });

  it("member A cannot see member B's blockers (permission: member_self via blocked_actor_id)", async () => {
    const b = makeBlocker("00000000-0000-4000-8001-000000000004", memberB.userId, "open");
    await db.objects.AgentBlocker.create(b);

    // A queries for B's blockers — should return empty (permission filter)
    const bundle = await getAgentBlockers(ctxA, memberB.userId);
    expect(bundle.data.blockers).toHaveLength(0);
  });

  it("steward can see all blockers", async () => {
    const b1 = makeBlocker("00000000-0000-4000-8001-000000000005", memberA.userId, "open");
    const b2 = makeBlocker("00000000-0000-4000-8001-000000000006", memberB.userId, "open");
    await db.objects.AgentBlocker.create(b1);
    await db.objects.AgentBlocker.create(b2);

    const bundleA = await getAgentBlockers(ctxSteward, memberA.userId);
    const bundleB = await getAgentBlockers(ctxSteward, memberB.userId);
    expect(bundleA.data.blockers).toHaveLength(1);
    expect(bundleB.data.blockers).toHaveLength(1);
  });
});
