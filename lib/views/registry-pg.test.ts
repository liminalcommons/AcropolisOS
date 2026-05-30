import { describe, expect, it, vi } from "vitest";
import { PgApprovedViewsRegistry } from "./registry-pg";

// Minimal fake Drizzle db: records the last upsert and serves get().
function fakeDb(seed: Record<string, unknown[]> = {}) {
  const store: Record<string, unknown[]> = { ...seed };
  return {
    store,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const key = (fakeDb as { _lastKey?: string })._lastKey ?? "";
            const rows = store[key];
            return rows ? [{ descriptors: rows }] : [];
          },
        }),
      }),
    }),
  };
}

describe("PgApprovedViewsRegistry", () => {
  it("get returns [] when no row exists", async () => {
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reg = new PgApprovedViewsRegistry(db as any);
    expect(await reg.get({ scope: "org", scope_key: "" })).toEqual([]);
  });

  it("get returns the row's descriptors when present", async () => {
    const descriptors = [{ id: "v1", kind: "metric", config: { type: "member", agg: "count" } }];
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ descriptors }] }) }) }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reg = new PgApprovedViewsRegistry(db as any);
    expect(await reg.get({ scope: "role", scope_key: "steward" })).toEqual(descriptors);
  });

  it("upsert issues an insert with an onConflictDoUpdate", async () => {
    const onConflictDoUpdate = vi.fn(async () => {});
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const db = { insert };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reg = new PgApprovedViewsRegistry(db as any);
    await reg.upsert({ scope: "org", scope_key: "" }, [], "steward@x");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });
});
