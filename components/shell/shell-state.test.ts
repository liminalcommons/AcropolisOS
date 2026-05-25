// components/shell/shell-state.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NAV_KEY, DOCK_KEY, readCollapsed, writeCollapsed } from "@/components/shell/shell-state";

describe("shell-state", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  it("defaults to not-collapsed when unset", () => {
    expect(readCollapsed(NAV_KEY)).toBe(false);
    expect(readCollapsed(DOCK_KEY)).toBe(false);
  });
  it("round-trips a collapsed=true write", () => {
    writeCollapsed(NAV_KEY, true);
    expect(readCollapsed(NAV_KEY)).toBe(true);
  });
  it("reads false when localStorage throws", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(readCollapsed(NAV_KEY)).toBe(false);
  });
});
