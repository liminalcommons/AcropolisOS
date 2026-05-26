// Per-row CHOICE pickers — DERIVED affordances for data_table rows, the
// "Confirm half" of the steward veto-queue (the Dismiss half lives in
// row-actions.ts).
//
// THE GENERALISATION (not a hardcoded "agent_blocker → pathway buttons"): an
// action is a ROW RESOLVER for object type T iff it declares a `row_resolver`
// mapping in the ontology AND its signature is structurally a CHOICE-driven
// operation on T — exactly ONE required `ref` param targeting T (the row id,
// reused from row-actions.ts's requiredRefParam) PLUS a second REQUIRED param
// (the `choice_param`) the chosen option binds to. The row carries the curated
// options under the `choices_from` column (a JSON array of {id,label}); the
// steward clicks one and that option's id is bound to `choice_param`.
//
// This is DISTINCT from a one-click row_action: a row_action has a SINGLE
// required ref and fires immediately; a row_resolver has a SECOND required
// param and is choice-driven (N buttons). The two affordance shapes are
// mutually exclusive by construction (one vs. two required params).
//
// PURE: no I/O, no db. The same rule is re-applied server-side in
// row-action.server.ts as the invocation gate — one rule, two call sites.

import type { Ontology } from "@/lib/ontology/schema";
import { CATALOG_VALID_TYPES, type CatalogType } from "./catalog";
import { requiredRefParam, catalogTypeToObjectType } from "./row-actions";

export interface RowResolver {
  /** the action_type name to invoke (e.g. "resolve_blocker_with_pathway") */
  action: string;
  /** the single required ref param the row id is bound to (e.g. "blocker_id") */
  refParam: string;
  /** the row column holding a JSON array of {id,label} choices (e.g. "pathways") */
  choicesFrom: string;
  /** the action param the chosen option's id binds to (e.g. "pathway_id") */
  choiceParam: string;
}

/**
 * THE STRUCTURAL RULE (single source of truth, shared by render + server gate).
 *
 * Returns a RowResolver iff ALL hold:
 *   1. The action declares a `row_resolver` mapping in the ontology (opt-in).
 *   2. requiredRefParam(def) returns a ref param — i.e. there is exactly ONE
 *      required ref. (For a resolver the SECOND required param is the
 *      choice_param, so requiredRefParam alone would return null; we therefore
 *      relax to: the ref must be the ONLY required REF, and the choice_param
 *      must be the only OTHER required param. See the implementation below.)
 *   3. `row_resolver.choice_param` is a REQUIRED param on the action.
 *
 * Else null. Type-AGNOSTIC: it does not check the ref's target — callers that
 * care about a specific object type (resolversForType) layer that check on top.
 */
export function rowResolverFor(
  actionDef: Ontology["action_types"][string] | undefined,
): RowResolver | null {
  if (!actionDef) return null;
  const rr = actionDef.row_resolver;
  if (!rr) return null;

  const params = actionDef.parameters;
  if (!params) return null;

  const requiredNames = Object.keys(params).filter(
    (name) => params[name].required === true,
  );

  // A resolver has exactly TWO required params: the ref (row id) and the
  // choice_param (the chosen option's id). Any other shape is rejected.
  if (requiredNames.length !== 2) return null;

  // The choice_param must be one of the required params.
  if (!requiredNames.includes(rr.choice_param)) return null;

  // The OTHER required param must be a single inline `ref` (the row-id target).
  // requiredRefParam expects exactly ONE required param, so we synthesise a def
  // with the choice_param dropped and reuse it — keeping the "single required
  // ref" structural logic in exactly one place (row-actions.ts).
  const refOnlyParams = Object.fromEntries(
    Object.entries(params).filter(([name]) => name !== rr.choice_param),
  );
  const refParam = requiredRefParam({
    ...actionDef,
    parameters: refOnlyParams,
  });
  if (!refParam) return null;

  return {
    action: "", // filled by callers that know the action name
    refParam,
    choicesFrom: rr.choices_from,
    choiceParam: rr.choice_param,
  };
}

// Render-side qualification: the structural rule PLUS the ref must target the
// specific object type whose rows we're decorating. Reuses rowResolverFor so
// the structural logic lives in exactly one place.
function qualifyingResolver(
  actionName: string,
  actionDef: Ontology["action_types"][string],
  objectTypeName: string,
): RowResolver | null {
  const resolver = rowResolverFor(actionDef);
  if (!resolver) return null;
  // The required ref must target THIS object type. (rowResolverFor already
  // confirmed it's an inline ref, so `target` is present.)
  const prop = actionDef.parameters![resolver.refParam];
  if (!("type" in prop) || prop.type !== "ref") return null;
  if (prop.target !== objectTypeName) return null;
  return { ...resolver, action: actionName };
}

/**
 * Scans the ontology's action_types and returns every row resolver available
 * for rows of the given catalog type. Pure — derived entirely from the ontology
 * shape, never from a per-type literal. Mirrors oneClickRowActionsForType.
 *
 * For `agent_blocker` this yields exactly [{ action:
 * "resolve_blocker_with_pathway", refParam: "blocker_id", choicesFrom:
 * "pathways", choiceParam: "pathway_id" }].
 */
export function resolversForType(
  catalogType: CatalogType,
  ontology: Ontology,
): RowResolver[] {
  // Defensive: an unknown type yields no resolvers (parity with read-api's fence).
  if (!(CATALOG_VALID_TYPES as readonly string[]).includes(catalogType)) {
    return [];
  }
  const objectTypeName = catalogTypeToObjectType(catalogType);

  const out: RowResolver[] = [];
  for (const [actionName, def] of Object.entries(ontology.action_types)) {
    const resolver = qualifyingResolver(actionName, def, objectTypeName);
    if (resolver) out.push(resolver);
  }
  return out;
}
