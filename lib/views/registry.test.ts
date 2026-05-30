// lib/views/registry.test.ts
import { describe, expect, it } from "vitest";
import {
  InMemoryApprovedViewsRegistry,
  scopeRowKey,
  type ApprovedViewDescriptor,
} from "./registry";

const D: ApprovedViewDescriptor = {
  id: "v-members",
  kind: "data_table",
  config: { type: "member", columns: ["handle"], limit: 20 },
  title: "Members",
};

describe("scopeRowKey", () => {
  it("is the scope and scope_key joined", () => {
    expect(scopeRowKey({ scope: "org", scope_key: "" })).toBe("org:");
    expect(scopeRowKey({ scope: "role", scope_key: "steward" })).toBe("role:steward");
    expect(scopeRowKey({ scope: "viewer", scope_key: "m-1" })).toBe("viewer:m-1");
  });
});

describe("InMemoryApprovedViewsRegistry", () => {
  it("get returns empty descriptors for an absent scope", async () => {
    const r = new InMemoryApprovedViewsRegistry();
    expect(await r.get({ scope: "org", scope_key: "" })).toEqual([]);
  });

  it("upsert then get round-trips descriptors", async () => {
    const r = new InMemoryApprovedViewsRegistry();
    await r.upsert({ scope: "role", scope_key: "steward" }, [D], "steward@x");
    expect(await r.get({ scope: "role", scope_key: "steward" })).toEqual([D]);
  });

  it("upsert REPLACES the row for the same scope (one active view per scope)", async () => {
    const r = new InMemoryApprovedViewsRegistry();
    await r.upsert({ scope: "org", scope_key: "" }, [D], "a");
    await r.upsert({ scope: "org", scope_key: "" }, [], "b");
    expect(await r.get({ scope: "org", scope_key: "" })).toEqual([]);
  });
});
