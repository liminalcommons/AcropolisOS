// US-022: Tool-registry refresh hook tests.
//
// The dev hot-reload pipeline needs a way for callers (the chat route, the
// SSE endpoint) to ask for a "current build" of Mastra tools without
// holding a stale reference. The registry caches the build until reload
// publishes — then it rebuilds on next access. This keeps Mastra tool
// shapes in sync with the regenerated ontology without a Next restart.

import { describe, expect, it, vi } from "vitest";
import { createReloadBus } from "./reload-bus";
import { createToolRegistry } from "./tool-registry";

describe("createToolRegistry", () => {
  it("caches the build until invalidate()", () => {
    const build = vi.fn(() => ({ count: 1 }));
    const reg = createToolRegistry(build);

    const a = reg.get();
    const b = reg.get();

    expect(build).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("rebuilds after invalidate()", () => {
    let n = 0;
    const reg = createToolRegistry(() => ({ count: ++n }));

    const first = reg.get();
    reg.invalidate();
    const second = reg.get();

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
  });

  it("invalidates on reload-bus publish when subscribed", () => {
    const bus = createReloadBus();
    let n = 0;
    const reg = createToolRegistry(() => ({ count: ++n }));
    reg.attachReloadBus(bus);

    const before = reg.get();
    bus.publish({ kind: "ontology", at: Date.now(), paths: ["m.yaml"] });
    const after = reg.get();

    expect(before.count).toBe(1);
    expect(after.count).toBe(2);
  });

  it("attachReloadBus returns an unsubscribe handle", () => {
    const bus = createReloadBus();
    let n = 0;
    const reg = createToolRegistry(() => ({ count: ++n }));
    const detach = reg.attachReloadBus(bus);

    detach();
    bus.publish({ kind: "ontology", at: Date.now(), paths: [] });

    // No invalidation -> still cached
    expect(reg.get().count).toBe(1);
    expect(reg.get().count).toBe(1);
  });
});
