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
//   2. type ∈ CATALOG_VALID_TYPES                    (else unknown_type)
//   3. config parses against WIDGET_CATALOG[kind] schema AND every
//      column/field/filter ∈ CATALOG_VALID_FIELDS[type]  (validateWidgetConfig)
//   4. canReadType(type) — the SAME fail-closed read fence the render path uses
//      (buildCanReadType). An actor who cannot read the type cannot compose a
//      widget that reads it. Reject; never persist a leak.
// On success: build a STABLE-id descriptor (compose-<type>-<kind>) and persist
// via addOrgWidget (append, or replace the same-id widget). The composed view
// appears immediately — no approval gate (decision #2).

import {
  WIDGET_CATALOG,
  validateWidgetConfig,
  CATALOG_VALID_TYPES,
  type CatalogKind,
} from "@/lib/widgets/catalog";
import type { CanReadType } from "@/lib/widgets/read-api";
import { addOrgWidget, type WidgetDescriptor } from "./store";

export interface ComposeOrgViewInput {
  kind: CatalogKind;
  type: string;
  columns?: string[];
  filter?: { field: string; value: string };
  limit?: number;
}

export type ComposeOrgViewResult =
  | { ok: true; descriptor: WidgetDescriptor }
  | { ok: false; reason: string };

// Assemble the per-kind catalog config from the flat agent input. The catalog
// schemas differ per kind (data_table/roster take a column list; metric takes
// agg + optional filter; calendar takes a date_field), so we shape the config
// here, then hand the WHOLE thing to validateWidgetConfig for the real check.
function buildConfig(input: ComposeOrgViewInput): unknown {
  const { kind, type, columns, filter, limit } = input;
  switch (kind) {
    case "data_table":
      return { type, columns: columns ?? [], ...(limit !== undefined ? { limit } : {}) };
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
  canReadType: CanReadType,
): Promise<ComposeOrgViewResult> {
  // 1. kind ∈ catalog
  if (!(input.kind in WIDGET_CATALOG)) {
    return { ok: false, reason: `unknown widget kind "${input.kind}"` };
  }

  // 2. type ∈ catalog types
  if (!(CATALOG_VALID_TYPES as readonly string[]).includes(input.type)) {
    return { ok: false, reason: `unknown type "${input.type}"` };
  }

  // 3. config parses against the kind's schema + columns/fields ⊆ ontology fields
  const config = buildConfig(input);
  const validation = validateWidgetConfig(input.kind, config);
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
    id: `compose-${input.type}-${input.kind}`,
    kind: input.kind,
    config: validation.config,
  };
  await addOrgWidget(descriptor);

  return { ok: true, descriptor };
}
