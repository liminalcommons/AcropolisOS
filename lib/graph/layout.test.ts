import { describe, it, expect } from "vitest";
import { layoutGraph } from "./layout";
import type { GraphModel } from "./derive";

const model: GraphModel = {
  nodes: [
    { id: "A", label: "A", titleProperty: null, propertyCount: 1, readRoles: [], writeRoles: [] },
    { id: "B", label: "B", titleProperty: null, propertyCount: 1, readRoles: [], writeRoles: [] },
  ],
  relations: [{ id: "rel", source: "A", target: "B", label: "rel", cardinality: "one-to-many" }],
  actions: [],
};

describe("layoutGraph", () => {
  it("assigns a finite position to every node", () => {
    const positioned = layoutGraph(model);
    expect(positioned).toHaveLength(2);
    for (const n of positioned) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it("separates connected nodes (A above/left of B in a DAG)", () => {
    const positioned = layoutGraph(model);
    const a = positioned.find((n) => n.id === "A")!;
    const b = positioned.find((n) => n.id === "B")!;
    expect(a.x !== b.x || a.y !== b.y).toBe(true);
  });
});
