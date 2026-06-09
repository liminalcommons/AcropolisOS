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
      title: { type: "string", required: false },
      capacity_max: { type: "string", required: false },
    });
    // GROW classifies the new type (workshop_session -> "session" -> event)
    expect(structural!.new_object_types.WorkshopSession.kind).toBe("event");
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
    expect(additive!.new_object_types.Guest.properties).toEqual({ dietary_pref: { type: "string", required: false } });
    expect(additive!.new_object_types.WorkTradeAgreement.properties).toEqual({ skill: { type: "string", required: false } });
    // grown fields must be EXPLICITLY optional (required: false -> nullable
    // column, reversible; omitting it generates a NOT NULL column -> drift/truncate)
    for (const ot of Object.values(additive!.new_object_types)) {
      for (const p of Object.values(ot.properties)) {
        expect((p as { required?: boolean }).required).toBe(false);
      }
    }
  });

  it("a new type whose fields reference an existing type also proposes a many-to-many link", () => {
    const decision: GrowDecision = {
      autoApply: [],
      escalate: [{ kind: "new_type", object_type: "booking", fields: ["guest_email", "nights"], evidence: ["raw_inbox:x"] }],
    };
    const { structural } = growDecisionToDiffs(decision, ontology);
    expect(Object.keys(structural!.new_object_types)).toEqual(["Booking"]);
    expect(structural!.new_object_types.Booking.kind).toBe("commitment"); // GROW classified it
    // guest_email -> Guest (exists in the fixture); nights -> no match
    expect(structural!.new_link_types).toEqual({
      booking_links_guest: { from: "Booking", to: "Guest", cardinality: "many-to-many" },
    });
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

  it("additive: copies op.evidence onto the diff keyed Type.field", () => {
    const decision = {
      autoApply: [
        { kind: "add_optional_field", object_type: "guest", field: "passport", evidence: ["raw_inbox:r1"] },
        { kind: "add_optional_field", object_type: "guest", field: "phone", evidence: ["raw_inbox:r2"] },
      ],
      escalate: [],
    } as GrowDecision;
    const { additive } = growDecisionToDiffs(decision, ontology);
    // folded critique Medium: two fields on ONE type keep SEPARATE evidence keys
    expect(additive!.evidence["Guest.passport"]).toEqual(["raw_inbox:r1"]);
    expect(additive!.evidence["Guest.phone"]).toEqual(["raw_inbox:r2"]);
  });

  it("structural: copies gp.evidence per field on a new type", () => {
    const decision = {
      autoApply: [],
      escalate: [
        { kind: "new_type", object_type: "vehicle", fields: ["plate", "make"], evidence: ["raw_inbox:r3"] },
      ],
    } as GrowDecision;
    const { structural } = growDecisionToDiffs(decision, ontology);
    expect(structural!.evidence["Vehicle.plate"]).toEqual(["raw_inbox:r3"]);
    expect(structural!.evidence["Vehicle.make"]).toEqual(["raw_inbox:r3"]);
  });
});
