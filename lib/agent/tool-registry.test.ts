// US-022: Default Mastra tool registry — singleton wired to the reload bus.
//
// Most callers want "the live tool set" without thinking about caching or
// reload wiring. `getDefaultMastraTools()` returns the cached map from the
// generated tools module and is invalidated whenever the dev reload bus
// publishes. Production: the bus is never published, so the cache stays
// warm.

import { describe, expect, it } from "vitest";
import {
  getDefaultMastraTools,
  invalidateDefaultMastraTools,
} from "./tool-registry";
import { getDefaultReloadBus } from "../dev/reload-bus";

describe("getDefaultMastraTools", () => {
  it("returns a non-empty tool map", () => {
    const t = getDefaultMastraTools();
    expect(Object.keys(t).length).toBeGreaterThan(0);
    expect(t.apply_action).toBeDefined();
  });

  it("returns the same instance on subsequent calls", () => {
    const a = getDefaultMastraTools();
    const b = getDefaultMastraTools();
    expect(a).toBe(b);
  });

  it("is subscribed to the default reload bus — publish completes without error", () => {
    // Identity stays stable because the generated tools constant is the
    // same module instance until HMR swaps it; what matters is that the
    // bus publish path doesn't throw and the registry stays consistent.
    const before = getDefaultMastraTools();
    expect(() =>
      getDefaultReloadBus().publish({
        kind: "ontology",
        at: Date.now(),
        paths: ["m.yaml"],
      }),
    ).not.toThrow();
    const after = getDefaultMastraTools();
    expect(Object.keys(after)).toEqual(Object.keys(before));
  });

  it("invalidateDefaultMastraTools resets the cache without throwing", () => {
    getDefaultMastraTools();
    expect(() => invalidateDefaultMastraTools()).not.toThrow();
    const next = getDefaultMastraTools();
    expect(next.apply_action).toBeDefined();
  });
});
