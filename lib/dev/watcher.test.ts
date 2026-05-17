// US-022: Watcher debounce primitive tests.
//
// The actual fs.watch glue is a thin orchestrator over Node's recursive
// watcher — what we test here is the debounce policy that decides when
// "noisy" change bursts turn into a single codegen run, because that's
// where the "felt latency" of the smoke loop comes from.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDebouncedTrigger, defaultArtifactMatcher } from "./watcher";

describe("createDebouncedTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses rapid pushes into a single call carrying every path", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const trigger = createDebouncedTrigger(fn, 50);

    trigger.push("a.yaml");
    trigger.push("b.yaml");
    trigger.push("a.yaml");

    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);

    expect(fn).toHaveBeenCalledTimes(1);
    const arg = fn.mock.calls[0][0] as string[];
    expect(new Set(arg)).toEqual(new Set(["a.yaml", "b.yaml"]));
  });

  it("fires again after the debounce drains, on a fresh push", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const trigger = createDebouncedTrigger(fn, 50);

    trigger.push("a.yaml");
    await vi.advanceTimersByTimeAsync(50);
    trigger.push("b.yaml");
    await vi.advanceTimersByTimeAsync(50);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0][0]).toEqual(["a.yaml"]);
    expect(fn.mock.calls[1][0]).toEqual(["b.yaml"]);
  });

  it("flush() empties the pending batch immediately", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const trigger = createDebouncedTrigger(fn, 500);

    trigger.push("a.yaml");
    await trigger.flush();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toEqual(["a.yaml"]);
  });

  it("flush() with no pending batch is a noop", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const trigger = createDebouncedTrigger(fn, 50);

    await trigger.flush();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("defaultArtifactMatcher", () => {
  it.each([
    ["object-types/member.yaml", true],
    ["link-types.yml", true],
    ["views/Member/list.tsx", true],
    ["views/Member/detail.tsx", true],
    ["app/page.tsx", false],
    ["lib/utils.ts", false],
    ["README.md", false],
  ])("matches %s -> %s", (relPath, expected) => {
    expect(defaultArtifactMatcher(relPath)).toBe(expected);
  });

  it("handles backslash paths on Windows", () => {
    expect(defaultArtifactMatcher("views\\Member\\list.tsx")).toBe(true);
    expect(defaultArtifactMatcher("object-types\\member.yaml")).toBe(true);
  });
});
