// US-022: Reload bus tests — minimal pub/sub used by the dev hot-reload
// pipeline. The watcher publishes; the SSE route + tool-registry subscribe.

import { describe, expect, it, vi } from "vitest";
import { createReloadBus, type ReloadEvent } from "./reload-bus";

describe("createReloadBus", () => {
  it("delivers a published event to every subscriber", () => {
    const bus = createReloadBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);

    const evt: ReloadEvent = { kind: "ontology", at: 1, paths: ["a.yaml"] };
    bus.publish(evt);

    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(evt);
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith(evt);
  });

  it("stops delivering after a subscriber unsubscribes", () => {
    const bus = createReloadBus();
    const fn = vi.fn();
    const unsub = bus.subscribe(fn);

    bus.publish({ kind: "view", at: 1, paths: ["x.tsx"] });
    unsub();
    bus.publish({ kind: "view", at: 2, paths: ["y.tsx"] });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("isolates subscriber errors so one bad listener does not block others", () => {
    const bus = createReloadBus();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    bus.subscribe(bad);
    bus.subscribe(good);

    bus.publish({ kind: "ontology", at: 1, paths: ["m.yaml"] });

    expect(bad).toHaveBeenCalledOnce();
    expect(good).toHaveBeenCalledOnce();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("getDefaultReloadBus returns a stable singleton", async () => {
    const { getDefaultReloadBus } = await import("./reload-bus");
    expect(getDefaultReloadBus()).toBe(getDefaultReloadBus());
  });
});
