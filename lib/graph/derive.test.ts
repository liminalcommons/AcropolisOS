import { describe, it, expect } from "vitest";
import { loadOntology } from "../ontology/load";
import { getRuntimeOntologyDir } from "../setup/paths";
import { ontologyToGraph, type GraphModel } from "./derive";

async function model(): Promise<GraphModel> {
  return ontologyToGraph(await loadOntology(getRuntimeOntologyDir()));
}

describe("ontologyToGraph", () => {
  it("emits one node per object type, sorted by id", async () => {
    const g = await model();
    expect(g.nodes.length).toBeGreaterThan(0);
    const ids = g.nodes.map((n) => n.id);
    expect([...ids].sort()).toEqual(ids);
    const member = g.nodes.find((n) => n.id === "Member");
    expect(member).toBeDefined();
    expect(member!.propertyCount).toBeGreaterThan(0);
  });

  it("emits one relation per link type carrying cardinality and endpoints", async () => {
    const g = await model();
    const attended = g.relations.find((r) => r.id === "attended");
    expect(attended).toMatchObject({
      source: "Member",
      target: "Event",
      cardinality: "many-to-many",
    });
  });

  it("attaches actions to their primary target with the agent policy", async () => {
    const g = await model();
    const checkIn = g.actions.find((a) => a.id === "check_in");
    expect(checkIn).toBeDefined();
    expect(checkIn!.policy).toBe("always_confirm");
    expect(checkIn!.primaryTarget).toBe("Booking");
    expect(checkIn!.permissions).toContain("steward");

    const claim = g.actions.find((a) => a.id === "claim_shift");
    expect(claim!.policy).toBe("auto_apply");
  });

  it("derives create/update/delete/read effects from the action declaration", () => {
    const synthetic = ontologyToGraph({
      properties: {},
      roles: {},
      object_types: {
        A: { properties: { id: { type: "uuid", primary_key: true } } },
        B: { properties: { id: { type: "uuid", primary_key: true } } },
      },
      link_types: {},
      action_types: {
        make_a: {
          creates_object: "A",
          parameters: { ref_b: { type: "ref", target: "B" } },
          agent_policy: "auto_apply",
        },
      },
    } as never);
    const act = synthetic.actions[0];
    expect(act.primaryTarget).toBe("A");
    expect(act.targets).toEqual(
      expect.arrayContaining([
        { objectType: "A", effect: "creates" },
        { objectType: "B", effect: "reads" },
      ]),
    );
  });

  it("is deterministic — same input yields identical output", async () => {
    const o = await loadOntology(getRuntimeOntologyDir());
    expect(ontologyToGraph(o)).toEqual(ontologyToGraph(o));
  });
});
