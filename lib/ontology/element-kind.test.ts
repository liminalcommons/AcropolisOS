import path from "node:path";
import { describe, expect, it } from "vitest";
import { ObjectType, LinkType, ElementKind, ELEMENT_KINDS } from "./schema";
import { loadOntology } from "./load";

describe("ElementKind kernel primitive", () => {
  it("fixes exactly the five universal element kinds", () => {
    expect(ELEMENT_KINDS).toEqual(["agent", "resource", "event", "commitment", "concept"]);
    expect(ElementKind.safeParse("agent").success).toBe(true);
    expect(ElementKind.safeParse("bogus").success).toBe(false);
  });

  it("ObjectType accepts an optional kind and rejects an unknown one", () => {
    const withKind = ObjectType.parse({ kind: "agent", properties: { id: { type: "uuid" } } });
    expect(withKind.kind).toBe("agent");
    expect(ObjectType.safeParse({ kind: "nope", properties: { id: { type: "uuid" } } }).success).toBe(false);
  });

  it("BACKWARD-COMPAT: an ObjectType without kind still parses (absent = unclassified)", () => {
    const noKind = ObjectType.parse({ properties: { id: { type: "uuid" } } });
    expect(noKind.kind).toBeUndefined();
  });

  it("LinkType accepts an optional kind (a link can be a commitment)", () => {
    const link = LinkType.parse({ from: "Guest", to: "Booking", cardinality: "one-to-many", kind: "commitment" });
    expect(link.kind).toBe("commitment");
    const noKind = LinkType.parse({ from: "Guest", to: "Booking", cardinality: "one-to-many" });
    expect(noKind.kind).toBeUndefined();
  });

  it("the live hostel ontology now carries valid, correct kinds on every type", async () => {
    const onto = await loadOntology(path.resolve(__dirname, "../../ontology"));
    expect(Object.keys(onto.object_types).length).toBeGreaterThan(0);
    // every type is classified, and each is a valid ElementKind
    for (const [name, ot] of Object.entries(onto.object_types)) {
      expect(ElementKind.safeParse(ot.kind).success, `${name} has a valid kind`).toBe(true);
    }
    // spot-check the load-bearing classifications
    expect(onto.object_types.Guest.kind).toBe("agent");
    expect(onto.object_types.Bed.kind).toBe("resource");
    expect(onto.object_types.Booking.kind).toBe("commitment");
    expect(onto.object_types.Event.kind).toBe("event");
  });
});
