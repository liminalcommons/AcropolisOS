import { describe, expect, it } from "vitest";
import type { Ontology } from "../ontology/schema";
import { inferLinks } from "./infer-links";

const ontology = {
  object_types: {
    Guest: { properties: { id: { type: "uuid" }, email: { type: "email" } } },
    Bed: { properties: { id: { type: "uuid" }, code: { type: "string" } } },
  },
  properties: {},
  link_types: {},
  action_types: {},
} as unknown as Ontology;

describe("inferLinks", () => {
  it("proposes a many-to-many link to an existing type a field references (FK-naming)", () => {
    const links = inferLinks(ontology, "Booking", ["guest_email", "bed_id", "nights"]);
    expect(links).toEqual([
      { name: "booking_links_guest", from: "Booking", to: "Guest", cardinality: "many-to-many", viaField: "guest_email" },
      { name: "booking_links_bed", from: "Booking", to: "Bed", cardinality: "many-to-many", viaField: "bed_id" },
    ]);
  });

  it("matches the bare type token and the <type>_id form", () => {
    expect(inferLinks(ontology, "Booking", ["guest"]).map((l) => l.to)).toEqual(["Guest"]);
    expect(inferLinks(ontology, "Booking", ["bed_id"]).map((l) => l.to)).toEqual(["Bed"]);
  });

  it("never self-links and dedupes repeated targets", () => {
    const links = inferLinks(ontology, "Guest", ["guest_id", "bed_code", "bed_id"]);
    // guest_* would self-link Guest -> dropped; bed_code + bed_id both -> Bed, deduped to one
    expect(links).toEqual([
      { name: "guest_links_bed", from: "Guest", to: "Bed", cardinality: "many-to-many", viaField: "bed_code" },
    ]);
  });

  it("returns nothing when no field references a known type", () => {
    expect(inferLinks(ontology, "Booking", ["nights", "price", "notes"])).toEqual([]);
  });
});
