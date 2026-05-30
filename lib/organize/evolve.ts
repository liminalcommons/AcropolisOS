// §6 GROW: the ingestion-gated evolve step. When data ingested doesn't fit, decide
// per the reversibility + concept-significance dial (§6.2):
//   - unknown field on an EXISTING type            → add_optional_field   → AUTO (additive, reversible)
//   - unknown target type (concept-level)          → new_type             → ESCALATE
// Every op cites the evidence rows that motivated it (§6.3 anti-bloat; §11.5
// growth is evidence-gated). No evidence → throw (cannot propose structure
// reality doesn't justify). Concept-level/lossy has a HARD always-escalate
// ceiling — no autonomy graduation (§4.3 / §11.4).
import type { Ontology } from "@/lib/ontology/schema";
import { pascalToSnake } from "@/lib/ontology/casing";

export interface GrowSignal {
  target_type: string; // snake token, e.g. "member"
  unfit_fields: Record<string, unknown>;
  evidence_rows: string[]; // e.g. ["raw_inbox:<id>"]
}

export interface GrowOp {
  kind: "add_optional_field";
  object_type: string;
  field: string;
  evidence: string[];
}

export interface GrowProposal {
  kind: "new_type";
  object_type: string;
  fields: string[];
  evidence: string[];
}

export interface GrowDecision {
  autoApply: GrowOp[];
  escalate: GrowProposal[];
}

function knownTypeTokens(ontology: Ontology): Set<string> {
  return new Set(Object.keys(ontology.object_types).map((n) => pascalToSnake(n)));
}

export function evaluateGrow(signal: GrowSignal, ontology: Ontology): GrowDecision {
  if (signal.evidence_rows.length === 0) {
    throw new Error("evolve: no evidence — growth is evidence-gated (§11.5)");
  }
  const known = knownTypeTokens(ontology);

  // Concept-level: the target type itself does not exist → new type → ESCALATE.
  if (!known.has(signal.target_type)) {
    return {
      autoApply: [],
      escalate: [
        {
          kind: "new_type",
          object_type: signal.target_type,
          fields: Object.keys(signal.unfit_fields),
          evidence: signal.evidence_rows,
        },
      ],
    };
  }

  // Existing type: each unfit field is an additive, reversible, optional field → AUTO.
  const autoApply: GrowOp[] = Object.keys(signal.unfit_fields).map((field) => ({
    kind: "add_optional_field",
    object_type: signal.target_type,
    field,
    evidence: signal.evidence_rows,
  }));
  return { autoApply, escalate: [] };
}
