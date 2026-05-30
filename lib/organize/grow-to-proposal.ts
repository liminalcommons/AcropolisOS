// Bridge: convert evaluateGrow's GrowDecision into the EXISTING proposal loop's
// ProposalDiff. evolve.ts emits intent (object_type + field NAMES, no property
// types); this synthesizes the InlineProperty bodies the proposal/apply pipeline
// needs. Pure — no I/O. Two diffs come back so the caller can treat them
// differently: `additive` (add_optional_field -> ALTER ADD COLUMN, safe to
// auto-apply) and `structural` (new_type -> CREATE TABLE, ALWAYS escalates).
//
// Invariants honored:
//  - grown fields are OPTIONAL (no `required`) -> nullable column, reversible
//    (a required/NOT NULL grow would trigger a drizzle-kit CASCADE truncate;
//    see MEMORY gotcha_calendar_bootstrap_schema_drift).
//  - the object-type key is the REAL ontology Pascal key (inverted from the live
//    keys), never a lossy snakeToPascal guess, for existing types.
//  - source keys are sanitized to safe snake identifiers before they reach YAML
//    codegen (a raw "Phone Number" would create an invalid column).
import type { Ontology, ObjectType } from "@/lib/ontology/schema";
import { pascalToSnake, snakeToPascal } from "@/lib/ontology/casing";
import { emptyDraft, type ProposalDiff } from "@/lib/proposals/diff";
import { inferLinks } from "./infer-links";
import { inferElementKind } from "./infer-kind";
import type { GrowDecision } from "./evolve";

export interface GrowDiffs {
  additive: ProposalDiff | null;
  structural: ProposalDiff | null;
}

// "Phone Number" -> "phone_number"; null when nothing safe remains.
export function sanitizeFieldName(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!s || /^[0-9]/.test(s)) return null;
  return s;
}

// Resolve a snake/Pascal token to the ontology's REAL Pascal key (invert real
// keys; never guess). Returns null when no existing type matches.
function existingPascal(ontology: Ontology, token: string): string | null {
  const snake = pascalToSnake(token);
  return Object.keys(ontology.object_types).find((k) => pascalToSnake(k) === snake) ?? null;
}

// Grown fields MUST be explicitly optional. Codegen treats a field with NO
// `required` key as NOT NULL (matching the ontology's convention — e.g. `notes`
// carries `required: false`). Omitting it would generate a NOT NULL column the
// ALTER adds as nullable -> generated-type/DB drift, and on a fresh push a NOT
// NULL add triggers a CASCADE truncate. `required: false` keeps it nullable and
// reversible.
const optionalString = () => ({ type: "string" as const, required: false });

export function growDecisionToDiffs(decision: GrowDecision, ontology: Ontology): GrowDiffs {
  let additive: ProposalDiff | null = null;
  if (decision.autoApply.length > 0) {
    const diff = emptyDraft();
    for (const op of decision.autoApply) {
      const pascal = existingPascal(ontology, op.object_type);
      if (!pascal) continue; // evaluateGrow only emits autoApply for known types
      const field = sanitizeFieldName(op.field);
      if (!field) continue;
      const ot: ObjectType = diff.new_object_types[pascal] ?? { properties: {} };
      ot.properties[field] = optionalString();
      diff.new_object_types[pascal] = ot;
    }
    if (Object.keys(diff.new_object_types).length > 0) additive = diff;
  }

  let structural: ProposalDiff | null = null;
  if (decision.escalate.length > 0) {
    const diff = emptyDraft();
    for (const gp of decision.escalate) {
      // A genuinely-new type: reuse a real key if it somehow exists, else derive
      // a Pascal name from the (snake) token.
      const pascal = existingPascal(ontology, gp.object_type) ?? snakeToPascal(gp.object_type);
      const properties: ObjectType["properties"] = {};
      for (const f of gp.fields) {
        const field = sanitizeFieldName(f);
        if (field) properties[field] = optionalString();
      }
      // ObjectType requires >=1 property; guarantee one.
      if (Object.keys(properties).length === 0) properties.name = optionalString();
      // Classify the grown type (heuristic first-guess; steward confirms on the
      // proposal). Defaults to `concept` when no name signal matches.
      diff.new_object_types[pascal] = { kind: inferElementKind(pascal), properties };

      // Shared-key -> link inference: a field that references an existing type
      // (FK-naming) proposes a many-to-many link, rendered dashed-amber on /graph
      // and approved by the steward (links are structural).
      for (const link of inferLinks(ontology, pascal, gp.fields)) {
        diff.new_link_types[link.name] = { from: link.from, to: link.to, cardinality: link.cardinality };
      }
    }
    if (Object.keys(diff.new_object_types).length > 0) structural = diff;
  }

  return { additive, structural };
}
