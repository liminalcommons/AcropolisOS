import { describe, expect, it } from "vitest";
import type { Ontology } from "@/lib/ontology/schema";
import { growDecisionToDiffs, sanitizeFieldName } from "./grow-to-proposal";
import type { GrowDecision } from "./evolve";

// Minimal ontology — growDecisionToDiffs only reads object_types keys.
const ontology = {
  object_types: {
    Guest: { properties: { full_name: { type: "string" } } },
    WorkTradeAgreement: { properties: { hours: { type: "integer" } } },
  },
  link_types: {},
  action_types: {},
  properties: {},
} as unknown as Ontology;

describe("sanitizeFieldName", () => {
  it("snake-cases human labels and drops unsafe leads", () => {
    expect(sanitizeFieldName("Phone Number")).toBe("phone_number");
    expect(sanitizeFieldName("dietary_pref")).toBe("dietary_pref");
    expect(sanitizeFieldName("  Check-In Date ")).toBe("check_in_date");
    expect(sanitizeFieldName("123abc")).toBeNull(); // leading digit -> skip
    expect(sanitizeFieldName("   ")).toBeNull();
  });
});

describe("growDecisionToDiffs", () => {
  it("new_type escalation -> structural diff with optional string fields", () => {
    const decision: GrowDecision = {
      autoApply: [],
      escalate: [
        { kind: "new_type", object_type: "workshop_session", fields: ["title", "Capacity Max"], evidence: ["raw_inbox:x"] },
      ],
    };
    const { additive, structural } = growDecisionToDiffs(decision, ontology);
    expect(additive).toBeNull();
    expect(structural).not.toBeNull();
    expect(Object.keys(structural!.new_object_types)).toEqual(["WorkshopSession"]);
    expect(structural!.new_object_types.WorkshopSession.properties).toEqual({
      title: { type: "string" },
      capacity_max: { type: "string" },
    });
  });

  it("add_optional_field -> additive diff keyed by the REAL existing Pascal type, optional fields", () => {
    const decision: GrowDecision = {
      autoApply: [
        { kind: "add_optional_field", object_type: "guest", field: "Dietary Pref", evidence: ["raw_inbox:x"] },
        { kind: "add_optional_field", object_type: "work_trade_agreement", field: "skill", evidence: ["raw_inbox:x"] },
      ],
      escalate: [],
    };
    const { additive, structural } = growDecisionToDiffs(decision, ontology);
    expect(structural).toBeNull();
    expect(additive).not.toBeNull();
    expect(additive!.new_object_types.Guest.properties).toEqual({ dietary_pref: { type: "string" } });
    expect(additive!.new_object_types.WorkTradeAgreement.properties).toEqual({ skill: { type: "string" } });
    // additive fields must be OPTIONAL (no required: true -> nullable column, reversible)
    for (const ot of Object.values(additive!.new_object_types)) {
      for (const p of Object.values(ot.properties)) {
        expect((p as { required?: boolean }).required).toBeUndefined();
      }
    }
  });

  it("a new type whose fields all sanitize away still gets a placeholder property (ObjectType requires >=1)", () => {
    const decision: GrowDecision = {
      autoApply: [],
      escalate: [{ kind: "new_type", object_type: "blank", fields: ["123", "   "], evidence: ["raw_inbox:x"] }],
    };
    const { structural } = growDecisionToDiffs(decision, ontology);
    expect(Object.keys(structural!.new_object_types.Blank.properties).length).toBeGreaterThanOrEqual(1);
  });

  it("empty decision -> both null", () => {
    expect(growDecisionToDiffs({ autoApply: [], escalate: [] }, ontology)).toEqual({ additive: null, structural: null });
  });
});
