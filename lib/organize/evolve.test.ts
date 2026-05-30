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
