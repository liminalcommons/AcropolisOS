import { describe, it, expect } from "vitest";
import type { Ontology } from "../ontology/schema";
import { deriveTypeDefaults, resolveDefaultToken } from "./derive-defaults";

describe("resolveDefaultToken", () => {
  it("passes static values through unchanged", () => {
    expect(resolveDefaultToken("EUR")).toBe("EUR");
    expect(resolveDefaultToken(0)).toBe(0);
    expect(resolveDefaultToken(false)).toBe(false);
  });
  it("resolves @today to a YYYY-MM-DD date", () => {
    expect(resolveDefaultToken("@today")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("resolves @now to an ISO timestamp", () => {
    expect(resolveDefaultToken("@now")).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z$/);
  });
  it("resolves @today+Nd to a date N days ahead", () => {
    const today = new Date().toISOString().slice(0, 10);
    const plus7 = resolveDefaultToken("@today+7d") as string;
    expect(plus7).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(plus7 > today).toBe(true);
  });
});

describe("deriveTypeDefaults", () => {
  const ontology = {
    properties: { country: { type: "string", default: "unknown" } },
    object_types: {
      Guest: {
        properties: {
          id: { type: "uuid", primary_key: true },
          country: { ref: "country" },
          arrived_at: { type: "date", default: "@today" },
          current_status: { type: "enum", values: ["booked"], default: "booked" },
          full_name: { type: "string" },
        },
      },
    },
    roles: {},
    link_types: {},
    action_types: {},
  } as unknown as Ontology;

  it("derives defaults from inline + ref'd properties, resolving tokens", () => {
    const d = deriveTypeDefaults(ontology, "Guest");
    expect(d.country).toBe("unknown"); // from the shared property
    expect(d.current_status).toBe("booked"); // inline static
    expect(d.arrived_at).toMatch(/^\d{4}-\d{2}-\d{2}$/); // token resolved
    expect("full_name" in d).toBe(false); // no default → omitted
    expect("id" in d).toBe(false);
  });

  it("returns {} for an unknown object type", () => {
    expect(deriveTypeDefaults(ontology, "Nope")).toEqual({});
  });
});
