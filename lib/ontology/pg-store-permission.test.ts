// M3.1 / US-031: object-level permission enforcement through the production
// ontology ctx pipeline.
//
// Why this exists separately from ctx.test.ts (which already covers the
// wrapObjectAccess decorator in isolation): the M3.1 acceptance criteria are
// about the wiring — when the production builder threads a real ontology
// (small-community seed) + real actor through createOntologyCtxForActor, do
// the declared permissions actually deny the expected operations end-to-end?
//
// We use createInMemoryStore here because the live-Postgres pg-store stub is
// not conducive to permission scenarios; the M2.2 step-2 test already pins
// the SQL behaviour of createPgOntologyStore. The wrap layer (wrapObjectAccess
// → ObjectAccess<T>) is the same code path whichever store sits underneath,
// so an in-memory store gives us a hermetic, fast permission contract test.
//
// Design notes captured during M3.1:
//   - Deny behaviour: `findById` returns null (info-hiding for member privacy);
//     `findMany` silently filters; `update`/`delete` throw PermissionError
//     (the caller passed an explicit id, the deny must be visible).
//   - `member_self` token resolves via rowOwnedBy in ctx.ts. For the Member
//     object type specifically, `actor.userId === row.id` is the convention
//     (the actor IS the member). For other types, `row.user_id` / `row.owner`
//     are probed.

import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Actor } from "../ctx";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  PermissionError,
} from "./ctx";
import { loadOntology } from "./load";
import type { Member } from "./types.generated";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SMALL_COMMUNITY = path.join(PKG_ROOT, "seed", "small-community");

// Real v4 UUIDs (gotcha_acropolisos_zod4_uuid_strict).
const MEMBER_A_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_B_ID = "22222222-2222-4222-8222-222222222222";

const stewardActor: Actor = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "steward@example.com",
  role: "steward",
  customRoles: [],
};

// IMPORTANT: actor.userId === Member.id is the convention that makes
// `member_self` work for the Member type. Tests that misalign this will
// silently fail the "member can read self" criterion.
const memberAActor: Actor = {
  userId: MEMBER_A_ID,
  email: "a@example.com",
  role: "member",
  customRoles: [],
};

const memberBActor: Actor = {
  userId: MEMBER_B_ID,
  email: "b@example.com",
  role: "member",
  customRoles: [],
};

function memberRow(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    full_name: `Member ${id.slice(0, 4)}`,
    email: `${id.slice(0, 4)}@example.com`,
    joined_at: "2026-01-01",
    tier: "basic",
    notes: "",
    ...overrides,
  };
}

async function seededDb() {
  const db = createInMemoryStore();
  await db.objects.Member.create(memberRow(MEMBER_A_ID, { full_name: "Alice" }));
  await db.objects.Member.create(memberRow(MEMBER_B_ID, { full_name: "Bob" }));
  return db;
}

async function loadPermissions() {
  const ontology = await loadOntology(SMALL_COMMUNITY);
  return buildObjectPermissionsMap(ontology);
}

describe("M3.1 / US-031 — object permissions wired via small-community seed", () => {
  it("steward can findById any Member", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const ctx = createCtx({ db, actor: stewardActor, permissions });
    expect(await ctx.objects.Member.findById(MEMBER_A_ID)).not.toBeNull();
    expect(await ctx.objects.Member.findById(MEMBER_B_ID)).not.toBeNull();
  });

  it("member can findById self (member_self via row.id === actor.userId)", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const ctx = createCtx({ db, actor: memberAActor, permissions });
    const self = await ctx.objects.Member.findById(MEMBER_A_ID);
    expect(self).not.toBeNull();
    expect(self?.id).toBe(MEMBER_A_ID);
  });

  it("member findById of OTHER member returns null (info-hiding deny)", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const ctx = createCtx({ db, actor: memberAActor, permissions });
    expect(await ctx.objects.Member.findById(MEMBER_B_ID)).toBeNull();
  });

  it("member findMany returns ONLY the member's own row (list-level filtering)", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const ctx = createCtx({ db, actor: memberAActor, permissions });
    const rows = await ctx.objects.Member.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(MEMBER_A_ID);
  });

  it("steward findMany returns all Member rows", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const ctx = createCtx({ db, actor: stewardActor, permissions });
    const rows = await ctx.objects.Member.findMany();
    expect(rows.map((r) => r.id).sort()).toEqual(
      [MEMBER_A_ID, MEMBER_B_ID].sort(),
    );
  });

  it("member can update self", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const ctx = createCtx({ db, actor: memberAActor, permissions });
    const updated = await ctx.objects.Member.update(MEMBER_A_ID, {
      full_name: "Alice Updated",
    });
    expect(updated?.full_name).toBe("Alice Updated");
  });

  it("member updating ANOTHER member throws PermissionError (explicit deny)", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const ctx = createCtx({ db, actor: memberAActor, permissions });
    await expect(
      ctx.objects.Member.update(MEMBER_B_ID, { tier: "lifetime" }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("member deleting ANOTHER member throws PermissionError", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const ctx = createCtx({ db, actor: memberAActor, permissions });
    await expect(
      ctx.objects.Member.delete(MEMBER_B_ID),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("steward can update + delete any Member", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const ctx = createCtx({ db, actor: stewardActor, permissions });
    const updated = await ctx.objects.Member.update(MEMBER_B_ID, {
      tier: "sustaining",
    });
    expect(updated?.tier).toBe("sustaining");
    expect(await ctx.objects.Member.delete(MEMBER_B_ID)).toBe(true);
  });

  it("null actor cannot read other members (no '*' read on tightened Member)", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const ctx = createCtx({ db, actor: null, permissions });
    expect(await ctx.objects.Member.findById(MEMBER_A_ID)).toBeNull();
    expect(await ctx.objects.Member.findMany()).toEqual([]);
  });

  it("member updating a missing member id returns null (no throw — row absent, not denied)", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const ctx = createCtx({ db, actor: memberAActor, permissions });
    expect(
      await ctx.objects.Member.update(
        "33333333-3333-4333-8333-333333333333",
        { notes: "x" },
      ),
    ).toBeNull();
  });
});

describe("M3.1 / US-031 — actor scope is not elevated by composition", () => {
  // The action-layer permission check (enforceActionPermission) governs WHO
  // can invoke an action. The object-layer wrap (this PR) governs which rows
  // the running ctx sees. Together they must compose: even if a member is
  // allowed to invoke action X (because X's permission is `member`), the
  // ctx that X runs under is still scoped to the member's row visibility.
  // A function-backed action that internally pokes another member's row via
  // ctx.objects.Member.update(otherId, ...) is denied at the object layer.
  it("member-scoped ctx denies cross-member writes regardless of action layer", async () => {
    const db = await seededDb();
    const permissions = await loadPermissions();
    const memberCtx = createCtx({
      db,
      actor: memberAActor,
      permissions,
    });
    // Simulate a function-backed action body running under memberCtx that
    // tries to elevate by acting on another member's row.
    await expect(
      memberCtx.objects.Member.update(MEMBER_B_ID, { tier: "lifetime" }),
    ).rejects.toBeInstanceOf(PermissionError);
    // And the row was NOT mutated.
    const verifyCtx = createCtx({ db, actor: stewardActor, permissions });
    const bob = await verifyCtx.objects.Member.findById(MEMBER_B_ID);
    expect(bob?.tier).toBe("basic");
  });
});
