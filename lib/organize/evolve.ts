// §6 GROW: the ingestion-gated evolve step. When data ingested doesn't fit, decide
// per the reversibility + concept-significance dial (§6.2):
//   - unknown field on an EXISTING type            → add_optional_field   → AUTO (additive, reversible)
//   - unknown target type (concept-level)          → new_type             → ESCALATE
// Every op cites the evidence rows that motivated it (§6.3 anti-bloat; §11.5
// growth is evidence-gated). No evidence → throw (cannot propose structure
// reality doesn't justify). Concept-level/lossy has a HARD always-escalate
// ceiling — no autonomy graduation (§4.3 / §11.4).
import type { Ontology } from "@/lib/ontology/schema";
import { pascalToSnake, snakeToPascal } from "@/lib/ontology/casing";

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

  // Normalize the incoming target_type to the same snake casing as the known
  // tokens. A Pascal-cased token (e.g. "Member") would otherwise miss the
  // `.has()` check and spuriously escalate an existing type as new_type.
  const targetToken = pascalToSnake(signal.target_type);

  // Concept-level: the target type itself does not exist → new type → ESCALATE.
  if (!known.has(targetToken)) {
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

  // Existing type: only GENUINELY-NEW fields are additive/reversible → AUTO.
  // A field that already exists on the type is a redefinition (not additive,
  // not reversible) and must NOT auto-apply — skip it. Look up the type's
  // declared properties from the ontology to filter.
  const existingProps = ontology.object_types[snakeToPascal(targetToken)]?.properties ?? {};
  // Field names collide case-INSENSITIVELY: a capitalized `Tier` is the same
  // field as an existing `tier` (a redefinition), not a genuinely-new add. Lower
  // the existing keys so a case variant is filtered out rather than smuggled in.
  const existingFieldSet = new Set(Object.keys(existingProps).map((f) => f.toLowerCase()));
  const autoApply: GrowOp[] = Object.keys(signal.unfit_fields)
    .filter((field) => !existingFieldSet.has(field.toLowerCase()))
    .map((field) => ({
      kind: "add_optional_field",
      object_type: signal.target_type,
      field,
      evidence: signal.evidence_rows,
    }));
  return { autoApply, escalate: [] };
}
