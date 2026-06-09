// Step-2b KEYSTONE: composeOrgView — the agent composes a GOVERNED widget view
// onto the steward org dashboard from a request.
//
// THE THESIS: the agent generates views FROM THE ONTOLOGY, not hand-coded
// screens. A "view" is NOT free-form HTML/code — it is a catalog widget
// descriptor (metric / data_table / roster / calendar) whose config is validated
// by the catalog's Zod schemas. The agent picks a kind + a type + columns; the
// catalog + read-api drive everything else.
//
// VALIDATION ORDER (fail-closed; nothing persists until ALL pass):
//   1. kind ∈ WIDGET_CATALOG                         (else invalid_kind)
//   2. type ∈ deriveVocabulary(ontology).validTypes  (else unknown_type)
//   3. config parses against WIDGET_CATALOG[kind] schema AND every
//      column/field/filter ∈ the type's ontology-derived field whitelist
//      (validateWidgetConfig — ontology-aware)
//   4. canReadType(type) — the SAME fail-closed read fence the render path uses
//      (buildCanReadType). An actor who cannot read the type cannot compose a
//      widget that reads it. Reject; never persist a leak.
// On success: build a STABLE-id descriptor (compose-<type>-<kind>) and persist
// via addOrgWidget (append, or replace the same-id widget). The composed view
// appears immediately — no approval gate (decision #2).

import {
  WIDGET_CATALOG,
  validateWidgetConfig,
  type CatalogKind,
} from "@/lib/widgets/catalog";
import { deriveVocabulary } from "@/lib/widgets/vocabulary";
import { rowActionColumns } from "@/lib/widgets/derive-board";
import type { Ontology } from "@/lib/ontology/schema";
import type { CanReadType } from "@/lib/widgets/read-api";
import {
  addOrgWidget,
  removeOrgWidget,
  clearOrgDashboard,
  type WidgetDescriptor,
} from "./store";

export interface ComposeOrgViewInput {
  kind: CatalogKind;
  type: string;
  columns?: string[];
  filter?: { field: string; value: string };
  limit?: number;
  title?: string;
  // data_table only: opt into per-row Resolve/Confirm affordances. When true,
  // composeOrgView AUTO-INJECTS the hidden columns those affordances read from
  // (the row id + each resolver's choices column + each confirm's source) so the
  // cards never render with undefined pathways — fail-closed governance, mirroring
  // the derived admin floor (derive-board.ts).
  row_actions?: boolean;
}

// STRUCTURAL WRITE-AUTHORIZATION (Axiom 2): every dashboard MUTATION requires
// proof of write-auth. canWriteDashboard is a REQUIRED boolean — there is no
// default that allows, so a caller physically cannot mutate the dashboard
// without supplying it. This is the orchestration layer; store.ts stays a dumb
// persistence layer with no auth. All three write ops gate identically and
// fail-closed (gate FIRST, before any other validation).
export interface DashboardWriteAuth {
  canReadType: CanReadType;
  canWriteDashboard: boolean;
  // The LOADED ontology — the source of the type-membership gate and the
  // column/field whitelist (deriveVocabulary). Threaded from the caller, which
  // already loaded it to build canReadType (buildCanReadType).
  ontology: Ontology;
}

export type ComposeOrgViewResult =
  | { ok: true; descriptor: WidgetDescriptor }
  | { ok: false; reason: string };

export type DashboardWriteResult =
  | { ok: true; existed?: boolean }
  | { ok: false; reason: string };

const NOT_AUTHORIZED = "Not authorized to modify the org dashboard.";

// Stable descriptor id for a composed widget: re-composing / removing the same
// type+kind targets the SAME widget (decision #2 — replace, not duplicate).
function composedId(type: string, kind: CatalogKind): string {
  return `compose-${type}-${kind}`;
}

// When a data_table opts into row_actions, the read fence selects ONLY the
// requested columns — so the HIDDEN columns the per-row Resolve/Confirm
// affordances read from (the row id + each resolver's choices column + each
// confirm's source) must be requested explicitly, or the cards render with
// UNDEFINED pathways. AUTO-INJECT them via a set-union (no duplicates) so a
// steward who composes [summary] still gets a working veto-queue. The derivation
// rule (rowActionColumns) is the SAME one the derived admin floor uses
// (derive-board.ts) — one rule, one place. For a type with NO row-action
// definitions this adds only the row id; it never invents a resolver/confirm
// column the ontology does not define.
function injectRowActionColumns(
  type: string,
  columns: string[],
  ontology: Ontology,
): string[] {
  const required = rowActionColumns(type, ontology);
  const merged = new Set<string>(columns);
  for (const c of required) merged.add(c);
  return [...merged];
}

// Assemble the per-kind catalog config from the flat agent input. The catalog
// schemas differ per kind (data_table/roster take a column list; metric takes
// agg + optional filter; calendar takes a date_field), so we shape the config
// here, then hand the WHOLE thing to validateWidgetConfig for the real check.
function buildConfig(input: ComposeOrgViewInput, ontology: Ontology): unknown {
  const { kind, type, columns, filter, limit, row_actions } = input;
  switch (kind) {
    case "data_table": {
      const baseCols = columns ?? [];
      // Fail-closed: row_actions:true → inject the hidden columns the affordances
      // depend on before validation, so the persisted config is self-sufficient.
      const cols = row_actions
        ? injectRowActionColumns(type, baseCols, ontology)
        : baseCols;
      return {
        type,
        columns: cols,
        ...(filter ? { filter } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(row_actions ? { row_actions: true } : {}),
      };
    }
    case "roster":
      return { type, fields: columns ?? [], ...(limit !== undefined ? { limit } : {}) };
    case "metric":
      return { type, agg: "count" as const, ...(filter ? { filter } : {}) };
    case "calendar":
      // calendar needs a date field; take the first requested column as the
      // date field (the agent supplies e.g. ["starts_at"] / ["from_date"]).
      return {
        type,
        date_field: columns?.[0] ?? "",
        ...(limit !== undefined ? { limit } : {}),
      };
    default:
      return { type };
  }
}

export async function composeOrgView(
  input: ComposeOrgViewInput,
  { canReadType, canWriteDashboard, ontology }: DashboardWriteAuth,
): Promise<ComposeOrgViewResult> {
  // 0. STRUCTURAL WRITE-AUTH (fail-closed, FIRST). A caller cannot mutate the
  // dashboard without proving write-auth — independent of, and prior to, the
  // per-type read fence. A readable public type (e.g. shift) still cannot be
  // composed by a non-writer.
  if (!canWriteDashboard) {
    return { ok: false, reason: NOT_AUTHORIZED };
  }

  // 1. kind ∈ catalog
  if (!(input.kind in WIDGET_CATALOG)) {
    return { ok: false, reason: `unknown widget kind "${input.kind}"` };
  }

  // 2. type ∈ the LOADED ontology's object types (ontology-derived membership gate)
  if (!deriveVocabulary(ontology).validTypes.includes(input.type)) {
    return { ok: false, reason: `unknown type "${input.type}"` };
  }

  // 3. config parses against the kind's schema + columns/fields ⊆ ontology fields.
  //    For a row_actions data_table the hidden affordance columns are injected
  //    here (before validation), so validateWidgetConfig re-checks the INJECTED
  //    columns against the ontology field whitelist too — a column derived from a
  //    valid ontology row-action is, by construction, a real field.
  const config = buildConfig(input, ontology);
  const validation = validateWidgetConfig(input.kind, config, ontology);
  if (!validation.ok) {
    return {
      ok: false,
      reason: `invalid widget config (${validation.error})`,
    };
  }

  // 4. FAIL-CLOSED read fence: the actor must be permitted to read this type.
  // Same predicate the /org render path gates every read with (buildCanReadType).
  if (!canReadType(input.type)) {
    return { ok: false, reason: `not authorized to read ${input.type}` };
  }

  // All gates passed — build a stable-id descriptor and persist.
  // Stable id (compose-<type>-<kind>) means re-composing the same type+kind
  // REPLACES that widget rather than duplicating it (decision #2).
  const descriptor: WidgetDescriptor = {
    id: composedId(input.type, input.kind),
    kind: input.kind,
    config: validation.config,
    title: input.title,
  };
  await addOrgWidget(descriptor);

  return { ok: true, descriptor };
}

// ── removeOrgView ───────────────────────────────────────────────────────────────
//
// Remove a single composed widget by its selector (kind + type → the stable
// composed id). Write-auth is gated FIRST (fail-closed), consistent with
// composeOrgView. Idempotent: removing an absent widget is ok:true (existed:false).
export async function removeOrgView(
  selector: { kind: CatalogKind; type: string },
  { canWriteDashboard }: { canWriteDashboard: boolean },
): Promise<DashboardWriteResult> {
  if (!canWriteDashboard) {
    return { ok: false, reason: NOT_AUTHORIZED };
  }
  const existed = await removeOrgWidget(composedId(selector.type, selector.kind));
  return { ok: true, existed };
}

// ── clearOrgView ────────────────────────────────────────────────────────────────
//
// Reset the whole dashboard to the default. Write-auth gated FIRST (fail-closed),
// consistent with composeOrgView/removeOrgView.
export async function clearOrgView({
  canWriteDashboard,
}: {
  canWriteDashboard: boolean;
}): Promise<DashboardWriteResult> {
  if (!canWriteDashboard) {
    return { ok: false, reason: NOT_AUTHORIZED };
  }
  await clearOrgDashboard();
  return { ok: true };
}
