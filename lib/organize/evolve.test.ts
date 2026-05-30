// lib/organize/evolve.test.ts
import { describe, expect, it } from "vitest";
import { evaluateGrow } from "./evolve";
import { loadOntology } from "../ontology/load";
import path from "node:path";

const SMALL = path.resolve(__dirname, "..", "..", "seed", "small-community");

describe("evaluateGrow — the reversibility dial (§6.2)", () => {
  it("an unknown field on an EXISTING type is additive+reversible → auto-apply, with evidence", async () => {
    const ontology = await loadOntology(SMALL);
    const out = evaluateGrow(
      {
        target_type: "member",
        unfit_fields: { phone: "555-1234" },
        evidence_rows: ["raw_inbox:abc"],
      },
      ontology,
    );
    expect(out.autoApply).toHaveLength(1);
    expect(out.autoApply[0]).toMatchObject({
      kind: "add_optional_field",
      object_type: "member",
      field: "phone",
    });
    expect(out.autoApply[0].evidence).toContain("raw_inbox:abc");
    expect(out.escalate).toHaveLength(0);
  });

  it("an unknown TARGET TYPE is concept-level → escalate, never auto-apply", async () => {
    const ontology = await loadOntology(SMALL);
    const out = evaluateGrow(
      {
        target_type: "household",
        unfit_fields: { address: "1 Main St" },
        evidence_rows: ["raw_inbox:xyz"],
      },
      ontology,
    );
    expect(out.autoApply).toHaveLength(0);
    expect(out.escalate).toHaveLength(1);
    expect(out.escalate[0].kind).toBe("new_type");
    expect(out.escalate[0].evidence).toContain("raw_inbox:xyz");
  });

  it("does NOT auto-apply add_optional_field for a field that ALREADY exists on the type (redefinition is not additive/reversible)", async () => {
    const ontology = await loadOntology(SMALL);
    // `tier` already exists on Member; `phone` does not.
    const out = evaluateGrow(
      {
        target_type: "member",
        unfit_fields: { tier: "x", phone: "555-1234" },
        evidence_rows: ["raw_inbox:abc"],
      },
      ontology,
    );
    // Only the genuinely-new field becomes an add_optional_field.
    expect(out.autoApply).toHaveLength(1);
    expect(out.autoApply[0]).toMatchObject({
      kind: "add_optional_field",
      object_type: "member",
      field: "phone",
    });
    // The existing `tier` field must NOT be auto-applied.
    expect(out.autoApply.some((op) => op.field === "tier")).toBe(false);
    expect(out.escalate).toHaveLength(0);
  });

  it("does NOT auto-apply a CASE-VARIANT of an existing field (case-insensitive field collision)", async () => {
    const ontology = await loadOntology(SMALL);
    // `tier` already exists on Member; a capitalized `Tier` is the SAME field,
    // not a genuinely-new one. It must collide case-insensitively and be skipped.
    const out = evaluateGrow(
      {
        target_type: "member",
        unfit_fields: { Tier: "platinum" },
        evidence_rows: ["raw_inbox:abc"],
      },
      ontology,
    );
    // The only field collides with an existing property → nothing to auto-apply.
    expect(out.autoApply).toHaveLength(0);
    expect(out.autoApply.some((op) => op.field === "Tier")).toBe(false);
    expect(out.autoApply.some((op) => op.field === "tier")).toBe(false);
    expect(out.escalate).toHaveLength(0);
  });

  it("does not spuriously escalate a Pascal-cased EXISTING type as new_type (casing normalization)", async () => {
    const ontology = await loadOntology(SMALL);
    const out = evaluateGrow(
      {
        target_type: "Member", // Pascal-cased token for an existing type
        unfit_fields: { phone: "555-1234" },
        evidence_rows: ["raw_inbox:abc"],
      },
      ontology,
    );
    // Member exists → must be treated as an existing type, NOT escalated.
    expect(out.escalate).toHaveLength(0);
    expect(out.autoApply).toHaveLength(1);
    expect(out.autoApply[0]).toMatchObject({
      kind: "add_optional_field",
      field: "phone",
    });
  });

  it("refuses to propose anything without evidence (growth is evidence-gated, §11.5)", async () => {
    const ontology = await loadOntology(SMALL);
    expect(() =>
      evaluateGrow(
        { target_type: "member", unfit_fields: { phone: "x" }, evidence_rows: [] },
        ontology,
      ),
    ).toThrow(/evidence/i);
  });
});
