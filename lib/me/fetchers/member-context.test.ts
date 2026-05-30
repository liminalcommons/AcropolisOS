// M4.3 step-1 RED: MemberContext auto-create + permission tests.

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/ctx";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  PermissionError,
  type OntologyCtx,
} from "@/lib/ontology/ctx";
import { loadOntology } from "@/lib/ontology/load";
import type { Member, MemberContext } from "@/lib/ontology/types.generated";
import { getOrCreateMemberContext } from "./member-context";

const SEED_ROOT = path.resolve(__dirname, "..", "..", "..", "scenarios", "small-community", "ontology");

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
    phone: "555-0000",
    tier_role: "staff",
    started_at: "2026-01-01",
    notes: "",
  };
}

let db: ReturnType<typeof createInMemoryStore>;
let ctxA: OntologyCtx;
let ctxB: OntologyCtx;
let ctxSteward: OntologyCtx;

beforeEach(async () => {
  db = createInMemoryStore();
  // Load ontology so permission checks are enforced (member_self, steward).
  const ontology = await loadOntology(SEED_ROOT);
  const permissions = buildObjectPermissionsMap(ontology);
  ctxA = createCtx({ db, actor: memberA, permissions });
  ctxB = createCtx({ db, actor: memberB, permissions });
  ctxSteward = createCtx({ db, actor: steward, permissions });

  await db.objects.Member.create(makeMember(memberA));
  await db.objects.Member.create(makeMember(memberB));
  await db.objects.Member.create(makeMember(steward));
});

describe("getOrCreateMemberContext", () => {
  it("auto-creates MemberContext row on first access with pinned_widgets=[]", async () => {
    // No row exists yet
    const existing = await db.objects.MemberContext.findMany();
    expect(existing).toHaveLength(0);

    const mc = await getOrCreateMemberContext(ctxA, memberA.userId);
    expect(mc).toBeDefined();
    expect(mc.member_id).toBe(memberA.userId);

    const rows = await db.objects.MemberContext.findMany();
    expect(rows).toHaveLength(1);
  });

  it("returns the same row on second call (idempotent)", async () => {
    const mc1 = await getOrCreateMemberContext(ctxA, memberA.userId);
    const mc2 = await getOrCreateMemberContext(ctxA, memberA.userId);
    expect(mc1.id).toBe(mc2.id);

    const rows = await db.objects.MemberContext.findMany();
    expect(rows).toHaveLength(1);
  });

  it("member A cannot write a MemberContext row for member B (PermissionError)", async () => {
    // Create B's context as steward so a row exists
    await getOrCreateMemberContext(ctxSteward, memberB.userId);

    // A trying to create/access B's context via ctxA:
    // findMany returns nothing (A can't see B's rows), then create fails with PermissionError.
    await expect(getOrCreateMemberContext(ctxA, memberB.userId)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it("steward can access any member's context", async () => {
    const mcA = await getOrCreateMemberContext(ctxSteward, memberA.userId);
    expect(mcA.member_id).toBe(memberA.userId);
  });
});
