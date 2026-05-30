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

  it("BACKWARD-COMPAT: the live hostel ontology (no kinds authored yet) still loads", async () => {
    const onto = await loadOntology(path.resolve(__dirname, "../../ontology"));
    expect(Object.keys(onto.object_types).length).toBeGreaterThan(0);
    // none classified yet — proves the field is purely additive
    expect(Object.values(onto.object_types).every((ot) => ot.kind === undefined)).toBe(true);
  });
});
