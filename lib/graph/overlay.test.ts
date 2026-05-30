import { describe, expect, it } from "vitest";
import { emptyDraft, type ProposalDiff } from "../proposals/diff";
import { buildOverlay, diffToGraph } from "./overlay";
import type { GraphModel, GraphNode } from "./derive";

function gnode(id: string, propertyCount = 1): GraphNode {
  return { id, label: id, titleProperty: null, propertyCount, readRoles: [], writeRoles: [] };
}

// A tiny committed graph: Guest -> Bed (sleeps_in).
const committed: GraphModel = {
  nodes: [gnode("Guest"), gnode("Bed")],
  relations: [
    { id: "sleeps_in", source: "Guest", target: "Bed", label: "sleeps_in", cardinality: "many-to-one" },
  ],
  actions: [],
};

function diffWith(parts: Partial<ProposalDiff>): ProposalDiff {
  return { ...emptyDraft(), ...parts };
}

describe("diffToGraph (project a pending proposal's diff to graph nodes/edges)", () => {
  it("maps new_object_types to nodes and new_link_types to relations", () => {
    const diff = diffWith({
      new_object_types: { Booking: { properties: { guest: { type: "string" }, nights: { type: "integer" } } } },
      new_link_types: { booked: { from: "Guest", to: "Booking", cardinality: "one-to-many" } },
    });
    const g = diffToGraph(diff);
    expect(g.nodes).toEqual([
      { id: "Booking", label: "Booking", titleProperty: null, propertyCount: 2, readRoles: [], writeRoles: [] },
    ]);
    expect(g.relations).toEqual([
      { id: "booked", source: "Guest", target: "Booking", label: "booked", cardinality: "one-to-many" },
    ]);
    expect(g.actions).toEqual([]);
  });
});

describe("buildOverlay (classify committed/proposed/growing)", () => {
  it("a brand-new object type + link are 'proposed' and merged into the model", () => {
    const diff = diffWith({
      new_object_types: { Booking: { properties: { guest: { type: "string" } } } },
      new_link_types: { booked: { from: "Guest", to: "Booking", cardinality: "one-to-many" } },
    });
    const o = buildOverlay(committed, [diff]);
    expect(o.nodeStatus).toEqual({ Guest: "committed", Bed: "committed", Booking: "proposed" });
    expect(o.edgeStatus).toEqual({ sleeps_in: "committed", booked: "proposed" });
    expect(o.model.nodes.map((n) => n.id).sort()).toEqual(["Bed", "Booking", "Guest"]);
    expect(o.model.relations.map((r) => r.id).sort()).toEqual(["booked", "sleeps_in"]);
  });

  it("fields added to an EXISTING type mark it 'growing' (no duplicate node) and record the field names", () => {
    const diff = diffWith({
      new_object_types: { Guest: { properties: { phone: { type: "string" }, passport: { type: "string" } } } },
    });
    const o = buildOverlay(committed, [diff]);
    expect(o.nodeStatus.Guest).toBe("growing");
    expect(o.growingFields.Guest).toEqual(["phone", "passport"]);
    // no duplicate Guest node
    expect(o.model.nodes.filter((n) => n.id === "Guest")).toHaveLength(1);
    expect(o.model.nodes).toHaveLength(2);
  });

  it("a proposed edge whose endpoint resolves to no node is DROPPED (truthful edgeStatus)", () => {
    const diff = diffWith({
      new_link_types: { orphan: { from: "Guest", to: "Ghost", cardinality: "one-to-many" } },
    });
    const o = buildOverlay(committed, [diff]);
    expect(o.edgeStatus.orphan).toBeUndefined();
    expect(o.model.relations.map((r) => r.id)).toEqual(["sleeps_in"]);
  });

  it("accumulates + dedupes growing fields across multiple diffs", () => {
    const d1 = diffWith({ new_object_types: { Guest: { properties: { phone: { type: "string" } } } } });
    const d2 = diffWith({ new_object_types: { Guest: { properties: { phone: { type: "string" }, age: { type: "integer" } } } } });
    const o = buildOverlay(committed, [d1, d2]);
    expect(o.nodeStatus.Guest).toBe("growing");
    expect(o.growingFields.Guest).toEqual(["phone", "age"]);
  });

  it("no proposals = committed graph unchanged", () => {
    const o = buildOverlay(committed, []);
    expect(o.model).toEqual(committed);
    expect(o.nodeStatus).toEqual({ Guest: "committed", Bed: "committed" });
    expect(o.edgeStatus).toEqual({ sleeps_in: "committed" });
    expect(o.growingFields).toEqual({});
  });
});
