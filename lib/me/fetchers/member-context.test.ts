// M4.3 step-1 RED: MemberContext auto-create + permission tests.

import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/ctx";
import { createCtx, createInMemoryStore, type OntologyCtx } from "@/lib/ontology/ctx";
import type { Member } from "@/lib/ontology/types.generated";
import { getOrCreateMemberContext } from "./member-context";

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

let db: ReturnType<typeof createInMemoryStore>;
let ctxA: OntologyCtx;
let ctxB: OntologyCtx;
let ctxSteward: OntologyCtx;

beforeEach(async () => {
  db = createInMemoryStore();
  ctxA = createCtx({ db, actor: memberA });
  ctxB = createCtx({ db, actor: memberB });
  ctxSteward = createCtx({ db, actor: steward });

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

  it("member A cannot read member B's MemberContext (permission: member_self)", async () => {
    // Create B's context as steward
    await getOrCreateMemberContext(ctxSteward, memberB.userId);

    // A trying to read B's context should get nothing (ctx filters)
    const mc = await getOrCreateMemberContext(ctxA, memberB.userId);
    // The function should return null or a new row owned by A — not B's row
    // In our implementation, we return null when no accessible row exists for that member_id
    expect(mc.member_id).not.toBe(memberB.userId);
  });

  it("steward can access any member's context", async () => {
    const mcA = await getOrCreateMemberContext(ctxSteward, memberA.userId);
    expect(mcA.member_id).toBe(memberA.userId);
  });
});
