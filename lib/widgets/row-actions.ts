// One-click row actions — DERIVED affordances for data_table rows.
//
// THE GENERALISATION (not a hardcoded "agent_blocker → Dismiss" button): a
// row in a data_table of object type T is "actionable in one click" by an
// action A iff A's signature is structurally a single-target operation on T —
// exactly ONE required parameter, and that parameter is a `ref` whose target
// IS T. Every OTHER parameter must be optional, so the only thing the click
// needs to supply is the row's id. The mechanism is type-agnostic: any future
// action shaped like `dismiss_blocker(blocker_id: ref<T> required)` becomes a
// row affordance for T automatically; anything needing a SECOND required param
// (e.g. `resolve_blocker_with_pathway` needs `pathway_id`) is excluded because
// it cannot be driven from a single row click.
//
// PURE: no I/O, no db. The same rule is re-applied server-side in
// row-action.server.ts as the invocation gate — one rule, two call sites.

import type { Ontology } from "@/lib/ontology/schema";
import { CATALOG_VALID_TYPES, type CatalogType } from "./catalog";

export interface RowAction {
  /** the action_type name to invoke (e.g. "dismiss_blocker") */
  action: string;
  /** the single required ref param the row id is bound to (e.g. "blocker_id") */
  refParam: string;
}

// SECURITY GATE (governed by the ontology). The structural "single required ref
// param" rule is necessary but NOT sufficient: it also admits privileged
// always_confirm actions like `promote_to_steward` (member ref) and
// `check_in`/`check_out` (booking ref). A one-click row affordance invokes with
// bypassConfirmation=true, so exposing those would silently defeat their
// always_confirm contract (e.g. minting a steward with no confirmation). An
// action must therefore OPT IN via `row_action: true` in its action_type YAML to
// surface as a one-click affordance — the safe set lives in the ontology, not a
// hand-maintained code list. Both the render helper and the server-side
// invocation gate (row-action.server.ts) enforce this flag.
export function isRowActionEnabled(
  actionDef: Ontology["action_types"][string],
): boolean {
  return actionDef.row_action === true;
}

// Catalog snake_case type → ontology PascalCase object-type name.
// Same forward mapping read-api.ts's CATALOG_TYPE_TO_OBJECT_TYPE encodes and
// resolve-refs.ts derives via snakeToPascal — kept derivational so it stays in
// sync with CATALOG_VALID_TYPES (no separate hand-maintained table to drift).
export function catalogTypeToObjectType(catalogType: CatalogType): string {
  return catalogType
    .split("_")
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");
}

/**
 * THE DERIVATION RULE (single source of truth — also enforced server-side).
 *
 * Given an action_type definition and the object-type name a row belongs to,
 * returns the single ref parameter name iff the action qualifies as a one-click
 * row action FOR that object type, else null. Qualifies iff:
 *   - it has exactly one REQUIRED parameter, AND
 *   - that required parameter is an inline `ref` whose `target` === objectTypeName.
 * (Every non-required parameter is irrelevant — it can be omitted at the click.)
 *
 * PropertyReference params ({ ref: "..." }) carry no `type`/`target`, so they
 * can never be the qualifying ref — the `"type" in prop` guard excludes them.
 */
function qualifyingRefParam(
  actionDef: Ontology["action_types"][string],
  objectTypeName: string,
): string | null {
  const params = actionDef.parameters;
  if (!params) return null;

  const requiredNames = Object.keys(params).filter(
    (name) => params[name].required === true,
  );
  if (requiredNames.length !== 1) return null;

  const refParam = requiredNames[0];
  const prop = params[refParam];
  // Must be an INLINE ref whose target is this object type.
  if (!("type" in prop) || prop.type !== "ref") return null;
  if (prop.target !== objectTypeName) return null;

  return refParam;
}

/**
 * Scans the ontology's action_types and returns every one-click row action
 * available for rows of the given catalog type. Pure — derived entirely from
 * the ontology shape, never from a per-type literal.
 *
 * For `agent_blocker` this yields exactly [{ action: "dismiss_blocker",
 * refParam: "blocker_id" }]: dismiss_blocker has one required ref<AgentBlocker>
 * (blocker_id) plus an OPTIONAL `reason`. The resolve_blocker_with_* actions
 * are EXCLUDED — each has a second required parameter (pathway_id / input_payload
 * / action_invocation), so requiredNames.length !== 1.
 */
export function oneClickRowActionsForType(
  catalogType: CatalogType,
  ontology: Ontology,
): RowAction[] {
  // Defensive: an unknown type yields no actions (parity with read-api's fence).
  if (!(CATALOG_VALID_TYPES as readonly string[]).includes(catalogType)) {
    return [];
  }
  const objectTypeName = catalogTypeToObjectType(catalogType);

  const out: RowAction[] = [];
  for (const [actionName, def] of Object.entries(ontology.action_types)) {
    // SECURITY: ontology opt-in (`row_action: true`) AND structural qualification.
    // The structural rule alone admits privileged actions (promote_to_steward,
    // check_in/out); the opt-in keeps the confirmation-bypassing one-click surface
    // to actions the ontology explicitly declares safe.
    if (!isRowActionEnabled(def)) continue;
    const refParam = qualifyingRefParam(def, objectTypeName);
    if (refParam) {
      out.push({ action: actionName, refParam });
    }
  }
  return out;
}
