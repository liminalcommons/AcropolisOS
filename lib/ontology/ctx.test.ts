import { describe, expect, it } from "vitest";
import { createCtx, createInMemoryStore } from "./ctx";
import type { Actor } from "../ctx";
import type { Member } from "./types.generated";

function memberRow(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    full_name: `Member ${id}`,
    email: `${id}@example.com`,
    joined_at: "2026-01-01",
    tier: "basic",
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
    await ctx.objects.Member.create(memberRow("m-1", { tier: "basic" }));
    await ctx.objects.Member.create(memberRow("m-2", { tier: "sustaining" }));
    await ctx.objects.Member.create(memberRow("m-3", { tier: "sustaining" }));
    const sustaining = await ctx.objects.Member.findMany({ tier: "sustaining" });
    expect(sustaining.map((m) => m.id).sort()).toEqual(["m-2", "m-3"]);
  });

  it("create rejects duplicate ids", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    await ctx.objects.Member.create(memberRow("m-1"));
    await expect(ctx.objects.Member.create(memberRow("m-1"))).rejects.toThrow(
      /already exists/,
    );
  });
});

describe("ontology createCtx — links.attended", () => {
  const at = "2026-05-01T12:00:00+00:00";

  it("create + traverse returns the edge with its properties", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    await ctx.links.attended.create({
      from: "m-1",
      to: "e-1",
      properties: { attended_at: at, role: "attendee" },
    });
    expect(await ctx.links.attended.traverse({ from: "m-1" })).toEqual([
      {
        from: "m-1",
        to: "e-1",
        properties: { attended_at: at, role: "attendee" },
      },
    ]);
  });

  it("traverse filters by from, by to, and by both", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    await ctx.links.attended.create({
      from: "m-1",
      to: "e-1",
      properties: { attended_at: at, role: "attendee" },
    });
    await ctx.links.attended.create({
      from: "m-1",
      to: "e-2",
      properties: { attended_at: at, role: "speaker" },
    });
    await ctx.links.attended.create({
      from: "m-2",
      to: "e-1",
      properties: { attended_at: at, role: "attendee" },
    });

    const fromM1 = await ctx.links.attended.traverse({ from: "m-1" });
    expect(fromM1.map((e) => e.to).sort()).toEqual(["e-1", "e-2"]);

    const toE1 = await ctx.links.attended.traverse({ to: "e-1" });
    expect(toE1.map((e) => e.from).sort()).toEqual(["m-1", "m-2"]);

    const both = await ctx.links.attended.traverse({ from: "m-1", to: "e-1" });
    expect(both).toHaveLength(1);
    expect(both[0].properties.role).toBe("attendee");
  });

  it("delete returns false when absent, true after the edge was created", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    expect(
      await ctx.links.attended.delete({ from: "m-1", to: "e-1" }),
    ).toBe(false);
    await ctx.links.attended.create({
      from: "m-1",
      to: "e-1",
      properties: { attended_at: at, role: "attendee" },
    });
    expect(
      await ctx.links.attended.delete({ from: "m-1", to: "e-1" }),
    ).toBe(true);
    expect(await ctx.links.attended.traverse({ from: "m-1" })).toEqual([]);
  });
});

describe("ontology createCtx — actions are stubs (real impl in US-027)", () => {
  it("record_attendance returns not_implemented", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    const result = await ctx.actions.record_attendance({
      member: "m-1",
      event: "e-1",
      role: "attendee",
    });
    expect(result).toEqual({
      ok: false,
      reason: "not_implemented",
      action: "record_attendance",
    });
  });

  it("add_member, add_meeting_minute, change_tier are stubbed too", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    expect(
      (await ctx.actions.add_member({
        full_name: "Bob",
        email: "bob@example.com",
        tier: "basic",
      })).reason,
    ).toBe("not_implemented");
    expect(
      (await ctx.actions.change_tier({ member: "m-1", new_tier: "lifetime" }))
        .reason,
    ).toBe("not_implemented");
    expect(
      (await ctx.actions.add_meeting_minute({
        title: "t",
        body: "b",
        event: "e-1",
      })).reason,
    ).toBe("not_implemented");
  });
});

describe("ontology createCtx — permission filtering is a no-op in M0", () => {
  it("exposes actor on the ctx so M3 can plug in without API churn", () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    expect(ctx.actor).toBe(steward);
  });

  it("null actor still has access in M0 — US-031 will tighten this", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: null });
    await ctx.objects.Member.create(memberRow("m-1"));
    expect(await ctx.objects.Member.findById("m-1")).not.toBeNull();
  });
});
