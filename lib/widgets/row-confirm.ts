// Per-row BINARY CONFIRM (row_confirm) — DERIVED affordances for data_table
// rows, the THIRD blocker-resolution shape after row_action (Dismiss, the "no")
// and row_resolver (N curated choices). A confirm is the agent's SINGLE proposed
// action: the steward clicks "Confirm: <label>" → the action is invoked with the
// invocation DERIVED SERVER-SIDE from the row's own `source` column.
//
// THE GENERALISATION (not a hardcoded "agent_blocker → Confirm"): an action is a
// ROW CONFIRM for object type T iff it declares a `row_confirm` mapping in the
// ontology AND its signature is structurally a confirm-driven operation on T —
// exactly ONE required `ref` param targeting T (the row id, reused from
// row-actions.ts's requiredRefParam) PLUS a second REQUIRED param (the
// `invocation_param`) the JSON-stringified `source.action` binds to. The row
// carries the proposal under the `source` column (a JSON object {label, action});
// the steward clicks Confirm and that action object's JSON binds to
// `invocation_param`.
//
// This is the SAME 2-required-param shape as a row_resolver (one ref + one other
// required), so it reuses the SAME "drop the non-ref required param, then
// requiredRefParam on the rest" trick — but the SECOND param is SERVER-DERIVED
// from the row (no client choice, no injection surface), where a resolver's
// second param is a client-picked (membership-validated) choice id.
//
// PURE: no I/O, no db. The same rule is re-applied server-side in
// row-action.server.ts as the invocation gate — one rule, two call sites.

import type { Ontology } from "@/lib/ontology/schema";
import { CATALOG_VALID_TYPES, type CatalogType } from "./catalog";
import { requiredRefParam, catalogTypeToObjectType } from "./row-actions";

export interface RowConfirm {
  /** the action_type name to invoke (e.g. "resolve_blocker_with_custom") */
  action: string;
  /** the single required ref param the row id is bound to (e.g. "blocker_id") */
  refParam: string;
  /** the row column holding the JSON {label, action} proposal (e.g. "confirm_action") */
  source: string;
  /** the action param the JSON-stringified source.action binds to (e.g. "action_invocation") */
  invocationParam: string;
}

/**
 * THE STRUCTURAL RULE (single source of truth, shared by render + server gate).
 *
 * Returns a RowConfirm iff ALL hold:
 *   1. The action declares a `row_confirm` mapping in the ontology (opt-in).
 *   2. The action has exactly TWO required params: the ref (row id) and the
 *      invocation_param. We reuse requiredRefParam by synthesising a def with
 *      the invocation_param dropped (the same trick rowResolverFor uses), so the
 *      "single required ref" structural logic lives in ONE place (row-actions.ts).
 *   3. `row_confirm.invocation_param` is a REQUIRED param on the action.
 *
 * Else null. Type-AGNOSTIC: it does not check the ref's target — callers that
 * care about a specific object type (confirmsForType) layer that check on top.
 *
 * For resolve_blocker_with_custom this yields { refParam: "blocker_id", source:
 * "confirm_action", invocationParam: "action_invocation" }.
 */
export function rowConfirmFor(
  actionDef: Ontology["action_types"][string] | undefined,
): RowConfirm | null {
  if (!actionDef) return null;
  const rc = actionDef.row_confirm;
  if (!rc) return null;

  const params = actionDef.parameters;
  if (!params) return null;

  const requiredNames = Object.keys(params).filter(
    (name) => params[name].required === true,
  );

  // A confirm has exactly TWO required params: the ref (row id) and the
  // invocation_param (the server-derived action JSON). Any other shape is rejected.
  if (requiredNames.length !== 2) return null;

  // The invocation_param must be one of the required params.
  if (!requiredNames.includes(rc.invocation_param)) return null;

  // The OTHER required param must be a single inline `ref` (the row-id target).
  // requiredRefParam expects exactly ONE required param, so we synthesise a def
  // with the invocation_param dropped and reuse it — keeping the "single required
  // ref" structural logic in exactly one place (row-actions.ts).
  const refOnlyParams = Object.fromEntries(
    Object.entries(params).filter(([name]) => name !== rc.invocation_param),
  );
  const refParam = requiredRefParam({
    ...actionDef,
    parameters: refOnlyParams,
  });
  if (!refParam) return null;

  return {
    action: "", // filled by callers that know the action name
    refParam,
    source: rc.source,
    invocationParam: rc.invocation_param,
  };
}

// Render-side qualification: the structural rule PLUS the ref must target the
// specific object type whose rows we're decorating. Reuses rowConfirmFor so the
// structural logic lives in exactly one place.
function qualifyingConfirm(
  actionName: string,
  actionDef: Ontology["action_types"][string],
  objectTypeName: string,
): RowConfirm | null {
  const confirm = rowConfirmFor(actionDef);
  if (!confirm) return null;
  // The required ref must target THIS object type. (rowConfirmFor already
  // confirmed it's an inline ref, so `target` is present.)
  const prop = actionDef.parameters![confirm.refParam];
  if (!("type" in prop) || prop.type !== "ref") return null;
  if (prop.target !== objectTypeName) return null;
  return { ...confirm, action: actionName };
}

/**
 * Scans the ontology's action_types and returns every row confirm available for
 * rows of the given catalog type. Pure — derived entirely from the ontology
 * shape, never from a per-type literal. Mirrors resolversForType.
 *
 * For `agent_blocker` this yields exactly [{ action:
 * "resolve_blocker_with_custom", refParam: "blocker_id", source:
 * "confirm_action", invocationParam: "action_invocation" }].
 */
export function confirmsForType(
  catalogType: CatalogType,
  ontology: Ontology,
): RowConfirm[] {
  // Defensive: an unknown type yields no confirms (parity with read-api's fence).
  if (!(CATALOG_VALID_TYPES as readonly string[]).includes(catalogType)) {
    return [];
  }
  const objectTypeName = catalogTypeToObjectType(catalogType);

  const out: RowConfirm[] = [];
  for (const [actionName, def] of Object.entries(ontology.action_types)) {
    const confirm = qualifyingConfirm(actionName, def, objectTypeName);
    if (confirm) out.push(confirm);
  }
  return out;
}

/**
 * PARSE the `source` column's `{ label, action }` proposal — the membership
 * equivalent for confirm (used by BOTH render and the server invocation gate).
 * Unlike a resolver's choice membership (which validates a client-supplied id),
 * a confirm's invocation is DERIVED from this parsed object server-side; this
 * parse is what makes the derivation safe.
 *
 * FAIL-CLOSED: a non-string input, non-JSON / corrupt string, non-object, a
 * missing/non-string `label`, or a missing `action` ALL return null. Pure (no
 * I/O), so it is unit-tested directly — covering the reject paths the live UI
 * never exercises (the UI only renders parsed proposals).
 */
export function parseConfirmAction(
  rawSource: unknown,
): { label: string; action: unknown } | null {
  if (typeof rawSource !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSource);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as { label?: unknown; action?: unknown };
  if (typeof obj.label !== "string") return null;
  if (obj.action === undefined) return null;
  return { label: obj.label, action: obj.action };
}

/**
 * BRIDGE: confirm_action.action → the `action_invocation` contract.
 *
 * Two field-name conventions coexist in the ontology: a blocker's
 * `confirm_action.action` is documented `{ type, params }` (agent-blocker.yaml,
 * what flag_blocker / the agent writes), but `resolve_blocker_with_custom`'s
 * `action_invocation` param is `{ action_type, params }` (the handler reads
 * `invocation.action_type`). Binding `confirm_action.action` verbatim therefore
 * yields `missing_action_type` and the blocker never resolves. This maps
 * `type → action_type` (preferring an explicit `action_type` if already present),
 * so a real agent-written `{ type, params }` confirm_action resolves correctly.
 * Defensive: a non-object action yields `action_type: undefined` (the handler
 * then fails closed with missing_action_type rather than throwing).
 */
export function toActionInvocation(
  action: unknown,
): { action_type: unknown; params: unknown } {
  const a =
    action != null && typeof action === "object"
      ? (action as { type?: unknown; action_type?: unknown; params?: unknown })
      : {};
  return { action_type: a.action_type ?? a.type, params: a.params };
}
