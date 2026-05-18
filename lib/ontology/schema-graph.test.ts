import { describe, expect, it } from "vitest";
import { ontologyToGraph } from "./schema-graph";
import type { Ontology } from "./schema";

function makeOntology(): Ontology {
  return {
    properties: {
      email: { type: "email" },
    },
    roles: {},
    object_types: {
      Member: {
        properties: {
          id: { type: "uuid", primary_key: true },
          full_name: { type: "string" },
          email: { ref: "email" },
        },
      },
      Event: {
        properties: {
          id: { type: "uuid", primary_key: true },
          title: { type: "string" },
        },
      },
      MeetingMinute: {
        properties: {
          id: { type: "uuid", primary_key: true },
          body: { type: "string" },
        },
      },
    },
    link_types: {
      attended: {
        from: "Member",
        to: "Event",
        cardinality: "many-to-many",
      },
      authored: {
        from: "Member",
        to: "MeetingMinute",
        cardinality: "one-to-many",
      },
    },
    action_types: {},
  };
}

describe("ontologyToGraph", () => {
  it("emits one node per object type", () => {
    const { nodes } = ontologyToGraph(makeOntology());
    expect(new Set(nodes.map((n) => n.id))).toEqual(
      new Set(["Event", "Member", "MeetingMinute"]),
    );
    expect(nodes).toHaveLength(3);
  });

  it("each node carries the object-type name and the property count", () => {
    const { nodes } = ontologyToGraph(makeOntology());
    const member = nodes.find((n) => n.id === "Member");
    expect(member).toBeDefined();
    expect(member?.data.label).toBe("Member");
    expect(member?.data.propertyCount).toBe(3);
  });

  it("emits one edge per link type with id=name, source=from, target=to", () => {
    const { edges } = ontologyToGraph(makeOntology());
    expect(edges).toHaveLength(2);
    const attended = edges.find((e) => e.id === "attended");
    expect(attended).toEqual(
      expect.objectContaining({
        id: "attended",
        source: "Member",
        target: "Event",
      }),
    );
    expect(attended?.data?.cardinality).toBe("many-to-many");
  });

  it("places nodes on a simple grid so the page renders something sane without layouting libs", () => {
    const { nodes } = ontologyToGraph(makeOntology());
    for (const n of nodes) {
      expect(typeof n.position.x).toBe("number");
      expect(typeof n.position.y).toBe("number");
    }
    // No two nodes share the same position
    const positions = nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("returns empty arrays when the ontology is empty", () => {
    const empty: Ontology = {
      properties: {},
      roles: {},
      object_types: {},
      link_types: {},
      action_types: {},
    };
    const { nodes, edges } = ontologyToGraph(empty);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});
