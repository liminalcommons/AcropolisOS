import { describe, expect, it } from "vitest";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  PermissionError,
  type ObjectPermissionsMap,
} from "./ctx";
import type { Actor } from "../ctx";
import type { Ontology } from "./schema";
import type { Member } from "./types.generated";

function memberRow(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    full_name: `Member ${id}`,
    email: `${id}@example.com`,
    phone: "555-0000",
    tier_role: "staff",
    started_at: "2026-01-01",
    notes: "",
    ...overrides,
  };
}

const steward: Actor = {
  userId: "u-1",
  email: "alice@example.com",
  role: "steward",
  customRoles: [],
};

describe("ontology createCtx — objects.Member CRUD", () => {
  it("findById returns null when missing", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    expect(await ctx.objects.Member.findById("nope")).toBeNull();
  });

  it("create + findById round-trips a Member", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    const m = memberRow("m-1");
    const created = await ctx.objects.Member.create(m);
    expect(created).toEqual(m);
    expect(await ctx.objects.Member.findById("m-1")).toEqual(m);
  });

  it("update applies a partial patch and preserves the id", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    await ctx.objects.Member.create(memberRow("m-1"));
    const updated = await ctx.objects.Member.update("m-1", { notes: "vip" });
    expect(updated?.notes).toBe("vip");
    expect(updated?.id).toBe("m-1");
    expect(updated?.full_name).toBe("Member m-1");
  });

  it("update returns null when target is missing", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    expect(await ctx.objects.Member.update("missing", { notes: "x" })).toBeNull();
  });

  it("delete returns true on success and removes the row", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    await ctx.objects.Member.create(memberRow("m-1"));
    expect(await ctx.objects.Member.delete("m-1")).toBe(true);
    expect(await ctx.objects.Member.findById("m-1")).toBeNull();
  });

  it("delete returns false when target is missing", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    expect(await ctx.objects.Member.delete("missing")).toBe(false);
  });

  it("findMany returns all rows when no filter is given", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    await ctx.objects.Member.create(memberRow("m-1"));
    await ctx.objects.Member.create(memberRow("m-2"));
    const all = await ctx.objects.Member.findMany();
    expect(all.map((m) => m.id).sort()).toEqual(["m-1", "m-2"]);
  });

  it("findMany filters by basic equality on any column", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    await ctx.objects.Member.create(memberRow("m-1", { tier_role: "staff" }));
    await ctx.objects.Member.create(memberRow("m-2", { tier_role: "work_trader" }));
    await ctx.objects.Member.create(memberRow("m-3", { tier_role: "work_trader" }));
    const workTraders = await ctx.objects.Member.findMany({ tier_role: "work_trader" });
    expect(workTraders.map((m) => m.id).sort()).toEqual(["m-2", "m-3"]);
  });

  it("create rejects duplicate ids", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    await ctx.objects.Member.create(memberRow("m-1"));
    await expect(ctx.objects.Member.create(memberRow("m-1"))).rejects.toThrow(
      /already exists/,
    );
  });
});

// NOTE: the former `links.attended` CRUD tests were removed here. Per ctx.ts the
// attended/authored link surface was "removed with community schema" — the
// runtime store exposes `links: {}` (no action uses creates_link). The tests
// exercised `ctx.links.attended`, a surface that no longer exists, so they were
// stale. (Residual `attended` entries linger in ontology/link-types.yaml + the
// generated member_attended_event table — a separate, harmless cleanup.)

describe("ontology createCtx — actions interface (hostel domain)", () => {
  it("OntologyActions is an empty interface (hostel actions wired via function-backed dispatcher)", () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    // actions is present on the ctx but empty — hostel-domain actions are
    // dispatched via invokeAction(ctx, ...) in the function-backed runner,
    // not as ctx.actions.X stubs. This test documents the current contract.
    expect(ctx.actions).toBeDefined();
  });
});

describe("ontology createCtx — permissions are pass-through when map is omitted", () => {
  it("exposes actor on the ctx", () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    expect(ctx.actor).toBe(steward);
  });

  it("null actor still has access when no permissions map is supplied", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: null });
    await ctx.objects.Member.create(memberRow("m-1"));
    expect(await ctx.objects.Member.findById("m-1")).not.toBeNull();
  });
});

// US-031: permission enforcement
const memberA: Actor = {
  userId: "user-a",
  email: "a@example.com",
  role: "member",
  customRoles: [],
};
const memberB: Actor = {
  userId: "user-b",
  email: "b@example.com",
  role: "member",
  customRoles: [],
};

const smallCommunityPermissions: ObjectPermissionsMap = {
  Member: {
    read: ["*"],
    write: ["steward", "member_self"],
    properties: {
      notes: { read: ["steward"], write: ["steward"] },
    },
  },
  Event: {
    read: ["*"],
    write: ["steward"],
  },
  MeetingMinute: {
    read: ["*"],
    write: ["steward"],
  },
};

describe("ontology createCtx — US-031 object-level read filtering", () => {
  it("returns rows readable by '*' to anyone, including null actor", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(memberRow("m-1"));
    const ctx = createCtx({
      db,
      actor: null,
      permissions: smallCommunityPermissions,
    });
    expect(await ctx.objects.Member.findById("m-1")).not.toBeNull();
    expect((await ctx.objects.Member.findMany()).map((m) => m.id)).toEqual(["m-1"]);
  });

  it("hides rows when actor role is absent from read tokens", async () => {
    const db = createInMemoryStore();
    await db.objects.Event.create({
      id: "e-1",
      title: "Town hall",
      starts_at: "2026-05-01T12:00:00+00:00",
      duration_hours: 2,
      organizer: "m-1",
      status: "scheduled",
    });
    const restrictive: ObjectPermissionsMap = {
      Event: { read: ["steward"], write: ["steward"] },
    };
    const stewardCtx = createCtx({ db, actor: steward, permissions: restrictive });
    const memberCtx = createCtx({ db, actor: memberA, permissions: restrictive });
    expect(await stewardCtx.objects.Event.findById("e-1")).not.toBeNull();
    expect(await memberCtx.objects.Event.findById("e-1")).toBeNull();
    expect(await memberCtx.objects.Event.findMany()).toEqual([]);
  });
});

describe("ontology createCtx — US-031 property-level read filtering", () => {
  it("omits Member.notes for a member-role actor", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(memberRow("m-1", { notes: "secret" }));
    const ctx = createCtx({
      db,
      actor: memberA,
      permissions: smallCommunityPermissions,
    });
    const fetched = await ctx.objects.Member.findById("m-1");
    expect(fetched).not.toBeNull();
    expect((fetched as Record<string, unknown>).notes).toBeUndefined();
    expect(fetched?.full_name).toBe("Member m-1");
  });

  it("keeps Member.notes for a steward", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(memberRow("m-1", { notes: "secret" }));
    const ctx = createCtx({
      db,
      actor: steward,
      permissions: smallCommunityPermissions,
    });
    const fetched = await ctx.objects.Member.findById("m-1");
    expect(fetched?.notes).toBe("secret");
  });

  it("strips notes across findMany results", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(memberRow("m-1", { notes: "alpha" }));
    await db.objects.Member.create(memberRow("m-2", { notes: "beta" }));
    const ctx = createCtx({
      db,
      actor: memberA,
      permissions: smallCommunityPermissions,
    });
    const all = await ctx.objects.Member.findMany();
    expect(all).toHaveLength(2);
    for (const row of all) {
      expect((row as Record<string, unknown>).notes).toBeUndefined();
    }
  });
});

describe("ontology createCtx — US-031 write enforcement", () => {
  it("throws PermissionError when a member tries to update another member", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(memberRow("user-a"));
    await db.objects.Member.create(memberRow("user-b"));
    const ctx = createCtx({
      db,
      actor: memberA,
      permissions: smallCommunityPermissions,
    });
    await expect(
      ctx.objects.Member.update("user-b", { full_name: "hacked" }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("permits a member to update their own Member row (member_self via row.id)", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(memberRow("user-a"));
    const ctx = createCtx({
      db,
      actor: memberA,
      permissions: smallCommunityPermissions,
    });
    const updated = await ctx.objects.Member.update("user-a", {
      full_name: "Alice Updated",
    });
    expect(updated?.full_name).toBe("Alice Updated");
  });

  it("permits a steward to update any Member row", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(memberRow("user-a"));
    const ctx = createCtx({
      db,
      actor: steward,
      permissions: smallCommunityPermissions,
    });
    const updated = await ctx.objects.Member.update("user-a", {
      full_name: "Steward Touched",
    });
    expect(updated?.full_name).toBe("Steward Touched");
  });

  it("throws PermissionError when a member tries to delete another member", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(memberRow("user-b"));
    const ctx = createCtx({
      db,
      actor: memberA,
      permissions: smallCommunityPermissions,
    });
    await expect(ctx.objects.Member.delete("user-b")).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it("throws PermissionError when a member tries to create an Event (steward-only write)", async () => {
    const db = createInMemoryStore();
    const ctx = createCtx({
      db,
      actor: memberA,
      permissions: smallCommunityPermissions,
    });
    await expect(
      ctx.objects.Event.create({
        id: "e-1",
        title: "Coup",
        starts_at: "2026-05-01T12:00:00+00:00",
        duration_hours: 2,
        organizer: "m-1",
        status: "scheduled",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("update returns null without throwing when the row does not exist", async () => {
    const db = createInMemoryStore();
    const ctx = createCtx({
      db,
      actor: memberA,
      permissions: smallCommunityPermissions,
    });
    expect(await ctx.objects.Member.update("missing", { notes: "x" })).toBeNull();
  });

  it("PermissionError carries actor/objectType/operation context", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(memberRow("user-b"));
    const ctx = createCtx({
      db,
      actor: memberA,
      permissions: smallCommunityPermissions,
    });
    try {
      await ctx.objects.Member.update("user-b", { full_name: "x" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      const pe = err as PermissionError;
      expect(pe.actorId).toBe("user-a");
      expect(pe.objectType).toBe("Member");
      expect(pe.operation).toBe("update");
    }
  });
});

describe("ontology createCtx — US-031 member_self via row.id (Member type)", () => {
  it("matches member_self when row.id equals actor.userId (Member is self-referencing)", async () => {
    const db = createInMemoryStore();
    // Member rows are self-referencing: row.id === actor.userId triggers member_self.
    await db.objects.Member.create(memberRow("user-a"));
    await db.objects.Member.create(memberRow("user-b"));
    const perms: ObjectPermissionsMap = {
      Member: { read: ["*"], write: ["steward", "member_self"] },
    };
    const ctxOwn = createCtx({ db, actor: memberA, permissions: perms });
    const ctxOther = createCtx({ db, actor: memberB, permissions: perms });
    await expect(
      ctxOwn.objects.Member.update("user-a", { notes: "self-edit" }),
    ).resolves.toMatchObject({ notes: "self-edit" });
    await expect(
      ctxOther.objects.Member.update("user-a", { notes: "nope" }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("ontology buildObjectPermissionsMap — derive from Ontology", () => {
  it("captures object-level and property-level read/write tokens", () => {
    const ontology = {
      properties: {},
      roles: {},
      object_types: {
        Member: {
          permissions: { read: ["*"], write: ["steward", "member_self"] },
          properties: {
            id: { type: "uuid" as const, primary_key: true },
            notes: {
              type: "string" as const,
              permissions: { read: ["steward"], write: ["steward"] },
            },
          },
        },
      },
      link_types: {},
      action_types: {},
    };
    const map = buildObjectPermissionsMap(ontology as unknown as Ontology);
    expect(map.Member?.read).toEqual(["*"]);
    expect(map.Member?.write).toEqual(["steward", "member_self"]);
    expect(map.Member?.properties?.notes?.read).toEqual(["steward"]);
  });
});
