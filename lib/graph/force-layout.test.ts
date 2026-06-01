// forceLayout is a pure, seeded force-directed layout: deterministic for a given
// seed (so it's testable and SSR-safe — no Date.now/Math.random) and bounded to
// the canvas. The client graph runs it in a useMemo and lets users drag from there.
import { describe, it, expect } from "vitest";
import { forceLayout } from "@/lib/graph/force-layout";

const model = {
  nodes: [
    { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" },
  ],
  edges: [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "a" },
    { source: "d", target: "a" },
  ],
};
const OPTS = { width: 800, height: 600, seed: 42 };

describe("forceLayout", () => {
  it("returns a position for every node", () => {
    const pos = forceLayout(model, OPTS);
    expect(pos.size).toBe(5);
    for (const n of model.nodes) expect(pos.get(n.id)).toBeDefined();
  });

  it("is deterministic for a fixed seed", () => {
    const a = forceLayout(model, OPTS);
    const b = forceLayout(model, OPTS);
    for (const n of model.nodes) {
      expect(a.get(n.id)).toEqual(b.get(n.id));
    }
  });

  it("differs for a different seed", () => {
    const a = forceLayout(model, { ...OPTS, seed: 1 });
    const b = forceLayout(model, { ...OPTS, seed: 999 });
    let anyDiff = false;
    for (const n of model.nodes) {
      const pa = a.get(n.id)!, pb = b.get(n.id)!;
      if (pa.x !== pb.x || pa.y !== pb.y) anyDiff = true;
    }
    expect(anyDiff).toBe(true);
  });

  it("keeps every position within the canvas bounds", () => {
    const pos = forceLayout(model, OPTS);
    for (const { x, y } of pos.values()) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(800);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
  });

  it("handles an empty model", () => {
    const pos = forceLayout({ nodes: [], edges: [] }, OPTS);
    expect(pos.size).toBe(0);
  });
});
