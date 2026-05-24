// US-021: Ctx-backed data provider for Refine.
//
// The generated Refine pages call into this provider to read and mutate
// ontology rows. It is typed against the OntologyCtx surface so resource
// names map onto ctx.objects.<Type>, and permission rejections from ctx
// propagate as DataProvider errors rather than being silently swallowed.

import { describe, expect, it } from "vitest";
import {
  createCtx,
  createInMemoryStore,
  buildObjectPermissionsMap,
} from "../ontology/ctx";
import { loadOntology } from "../ontology/load";
import path from "node:path";
import { createOntologyDataProvider } from "./data-provider";
import type { Member } from "../ontology/types.generated";

const SEED_DIR = path.join(
  __dirname,
  "..",
  "..",
  "seed",
  "small-community",
);

function newMember(overrides: Partial<Member> = {}): Member {
  return {
    id: overrides.id ?? "11111111-1111-1111-1111-111111111111",
    full_name: overrides.full_name ?? "Ada Member",
    email: overrides.email ?? "ada@example.com",
    phone: overrides.phone ?? "555-0000",
    tier_role: overrides.tier_role ?? "staff",
    started_at: overrides.started_at ?? "2026-01-01",
    notes: overrides.notes ?? "",
  };
}

describe("createOntologyDataProvider — list and one", () => {
  it("getList delegates to ctx.objects.<Type>.findMany", async () => {
    const onto = await loadOntology(SEED_DIR);
    const db = createInMemoryStore();
    await db.objects.Member.create(newMember({ id: "a", full_name: "Ada" }));
    await db.objects.Member.create(newMember({ id: "b", full_name: "Bea" }));
    const ctx = createCtx({
      db,
      actor: { userId: "s", email: "s@x", role: "steward", customRoles: [] },
      permissions: buildObjectPermissionsMap(onto),
    });
    const dp = createOntologyDataProvider(ctx);
    const out = await dp.getList({ resource: "Member" });
    expect(out.total).toBe(2);
    expect(out.data.map((r) => (r as Member).full_name).sort()).toEqual([
      "Ada",
      "Bea",
    ]);
  });

  it("getOne delegates to ctx.objects.<Type>.findById", async () => {
    const db = createInMemoryStore();
    const m = newMember({ id: "c", full_name: "Cal" });
    await db.objects.Member.create(m);
    const ctx = createCtx({
      db,
      actor: { userId: "s", email: "s@x", role: "steward", customRoles: [] },
    });
    const dp = createOntologyDataProvider(ctx);
    const out = await dp.getOne({ resource: "Member", id: "c" });
    expect((out.data as Member).full_name).toBe("Cal");
  });

  it("unknown resource throws a descriptive error", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: null });
    const dp = createOntologyDataProvider(ctx);
    await expect(dp.getOne({ resource: "Nope", id: "x" })).rejects.toThrow(
      /unknown resource/i,
    );
  });
});

describe("createOntologyDataProvider — mutations", () => {
  it("create delegates to ctx.objects.<Type>.create", async () => {
    const db = createInMemoryStore();
    const ctx = createCtx({
      db,
      actor: { userId: "s", email: "s@x", role: "steward", customRoles: [] },
    });
    const dp = createOntologyDataProvider(ctx);
    const m = newMember({ id: "d", full_name: "Dia" });
    const out = await dp.create({ resource: "Member", variables: m });
    expect((out.data as Member).id).toBe("d");
    const found = await db.objects.Member.findById("d");
    expect(found?.full_name).toBe("Dia");
  });

  it("update delegates to ctx.objects.<Type>.update", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(newMember({ id: "e", full_name: "Eve" }));
    const ctx = createCtx({
      db,
      actor: { userId: "s", email: "s@x", role: "steward", customRoles: [] },
    });
    const dp = createOntologyDataProvider(ctx);
    const out = await dp.update({
      resource: "Member",
      id: "e",
      variables: { full_name: "Eva" },
    });
    expect((out.data as Member).full_name).toBe("Eva");
  });

  it("deleteOne delegates to ctx.objects.<Type>.delete", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(newMember({ id: "f", full_name: "Fae" }));
    const ctx = createCtx({
      db,
      actor: { userId: "s", email: "s@x", role: "steward", customRoles: [] },
    });
    const dp = createOntologyDataProvider(ctx);
    const out = await dp.deleteOne({ resource: "Member", id: "f" });
    expect(out.data.ok).toBe(true);
    expect(await db.objects.Member.findById("f")).toBeNull();
  });
});

describe("createOntologyDataProvider — permission propagation", () => {
  it("anonymous actor on write-restricted resource surfaces a PermissionError", async () => {
    const onto = await loadOntology(SEED_DIR);
    const db = createInMemoryStore();
    const ctx = createCtx({
      db,
      actor: null,
      permissions: buildObjectPermissionsMap(onto),
    });
    const dp = createOntologyDataProvider(ctx);
    await expect(
      dp.create({ resource: "Member", variables: newMember() }),
    ).rejects.toThrow();
  });
});
