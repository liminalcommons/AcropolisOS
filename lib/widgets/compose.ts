// V2: compose_dashboard + resolveDashboard
//
// compose_dashboard — steward/self-gated action: validates each selection's
//   config against WIDGET_CATALOG[kind].configSchema, then writes validated
//   descriptors to member_context.pinned_widgets for that member.
//   Invalid configs are rejected with a structured error — garbage is never
//   persisted.
//
// resolveDashboard — read-only: reads pinned_widgets, builds a ReadOnlyDataApi
//   once, then for each descriptor runs queryBinding(config, api).
//   Bindings receive the api, NOT db — structurally cannot write.
//
// THE FENCE: resolveDashboard passes a ReadOnlyDataApi (no mutation methods) to
// queryBindings. compose_dashboard writes only to member_context.pinned_widgets,
// which is the dashboard config column, not world-model data.

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { member_context } from "@/lib/db/schema.generated";
import type { Database } from "@/lib/db/client";
import {
  CATALOG_KINDS,
  WIDGET_CATALOG,
  validateWidgetConfig,
  describeValidationError,
  type CatalogKind,
  type MetricData,
  type DataTableData,
  type RosterData,
  type CalendarData,
} from "./catalog";
import { createReadOnlyDataApi, type CanReadType } from "./read-api";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import type { RowResolver } from "./row-resolver";
import type { RowConfirm } from "./row-confirm";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WidgetSelection {
  kind: CatalogKind;
  config: unknown;
}

export type ComposeDashboardResult =
  | { status: "ok"; persisted: number }
  | { status: "validation_error"; errors: Array<{ index: number; kind: string; error: string; detail?: unknown }> };

// The single async-state discriminant the renderer dispatches on — the keystone
// of the "totality of states" pillar. Set ONCE in the resolution seam so no
// screen re-derives or swallows it:
//   ok    — data present and non-empty
//   empty — resolved cleanly, but the backing collection has no rows/entries/buckets
//   drift — stored config no longer validates against the ontology (paired with
//           validation_error) — the steward must SEE and fix the broken view
//   error — the data binding threw at resolve time (paired with `error`) — one
//           widget's failure no longer drops it or nukes the whole board
export type WidgetStatus = "ok" | "empty" | "drift" | "error";

export interface ResolvedWidget {
  id: string;
  kind: CatalogKind;
  config: unknown;
  status: WidgetStatus;
  // Generic, VIEWER-SAFE message for a status:"error" widget. NEVER the raw
  // exception (that is console.error'd server-side only) — no SQL/internal leak.
  error?: { message: string };
  // `null` ONLY when validation_error is set: a descriptor whose config no longer
  // validates against the loaded ontology (structural drift — a type renamed/
  // removed, a field deleted) is surfaced as a data-less error widget, never
  // silently dropped. The renderer shows an error card so the steward SEES the
  // broken view (governance over silent mutation).
  data: MetricData | DataTableData | RosterData | CalendarData | null;
  // Set when this widget's stored config failed validateWidgetConfig against the
  // current ontology. Plain serializable strings only (the Zod-issue detail is
  // NOT carried) so the error card hydrates without circular-ref / non-clonable
  // payloads. `kind` is the validateWidgetConfig error code (e.g. "unknown_type",
  // "unknown_columns"); `error` is a human-readable, type-naming message.
  validation_error?: { kind: string; error: string };
  title?: string;
  // Populated only for data_table widgets opted into row_actions: the
  // ontology-derived one-click actions (e.g. dismiss_blocker → blocker_id) the
  // card renders as a per-row Actions cell. Computed at resolve time where the
  // ontology is already loaded (runDescriptors), so the card stays data-only.
  rowActions?: Array<{ action: string; refParam: string }>;
  // Populated alongside rowActions (same opt-in): the ontology-derived per-row
  // CHOICE pickers (row_resolver). Each carries the action + the choicesFrom
  // column whose per-row JSON {id,label} array supplies the choice buttons.
  // The CHOICES themselves come from each row's choicesFrom column at render
  // time — only the resolver DEFINITIONS for the widget's type live here.
  rowResolvers?: RowResolver[];
  // Populated alongside rowActions/rowResolvers (same opt-in): the
  // ontology-derived per-row BINARY CONFIRMs (row_confirm). Each carries the
  // action + the `source` column whose per-row JSON {label, action} proposal
  // supplies the Confirm button's label; the invocation is derived server-side
  // from that same column (the client supplies only the row id).
  rowConfirms?: RowConfirm[];
}

// The shape stored in member_context.pinned_widgets (JSON array).
interface StoredDescriptor {
  id: string;
  kind: CatalogKind;
  config: unknown;
  title?: string;
}

// ── compose_dashboard ────────────────────────────────────────────────────────
//
// Validates all selections first. On any validation failure, rejects the
// entire batch (structured error, nothing persisted).
// On full success, writes the validated descriptors to the member_context row
// (creates the row if it doesn't exist yet).
//
// Role gate: callers are responsible for checking actor.role === "steward" or
// that the actor is operating on their own member_id. The function itself does
// not inspect the session — it is a pure DB operation gated by the caller.

export async function compose_dashboard(
  db: Database,
  memberId: string,
  selections: WidgetSelection[],
): Promise<ComposeDashboardResult> {
  // The loaded ontology is the SOURCE of validateWidgetConfig's membership +
  // field whitelist (deriveVocabulary). Loaded once for the whole batch.
  const ontology = await loadOntology(getRuntimeOntologyDir());

  // Step 1: Validate all configs — fail fast on first invalid, collect all errors
  const errors: Array<{ index: number; kind: string; error: string; detail?: unknown }> = [];

  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];

    // Reject unknown kinds
    if (!CATALOG_KINDS.includes(sel.kind as CatalogKind)) {
      errors.push({
        index: i,
        kind: sel.kind,
        error: "unknown_kind",
        detail: { allowed: CATALOG_KINDS },
      });
      continue;
    }

    const result = validateWidgetConfig(sel.kind as CatalogKind, sel.config, ontology);
    if (!result.ok) {
      errors.push({
        index: i,
        kind: sel.kind,
        error: result.error,
        detail: result.detail,
      });
    }
  }

  if (errors.length > 0) {
    return { status: "validation_error", errors };
  }

  // Step 2: Build validated descriptors (assign stable IDs)
  const descriptors: StoredDescriptor[] = selections.map((sel) => ({
    id: randomUUID(),
    kind: sel.kind as CatalogKind,
    config: sel.config,
  }));

  const now = new Date();

  // Step 3: Upsert member_context.pinned_widgets
  // Look up existing row first
  const existing = await db
    .select({ id: member_context.id })
    .from(member_context)
    .where(eq(member_context.member_id, memberId))
    .limit(1);

  if (existing.length > 0) {
    // Update existing row
    await db
      .update(member_context)
      .set({
        pinned_widgets: JSON.stringify(descriptors),
        updated_at: now,
      })
      .where(eq(member_context.member_id, memberId));
  } else {
    // Create new member_context row
    await db.insert(member_context).values({
      member_id: memberId,
      pinned_widgets: JSON.stringify(descriptors),
      created_at: now,
      updated_at: now,
    });
  }

  return { status: "ok", persisted: descriptors.length };
}

// ── resolveDashboard ─────────────────────────────────────────────────────────
//
// Reads pinned_widgets for the given member, builds a ReadOnlyDataApi once,
// then for each descriptor runs queryBinding(config, api).
//
// THE FENCE (V2): bindings receive api (ReadOnlyDataApi), NOT db. The api type
// has no insert/update/delete/create method — bindings physically cannot write.
// This function never writes to the world-model.

export async function resolveDashboard(
  db: Database,
  memberId: string,
  canReadType: CanReadType,
): Promise<ResolvedWidget[]> {
  // Fetch the member_context row
  const rows = await db
    .select({ pinned_widgets: member_context.pinned_widgets })
    .from(member_context)
    .where(eq(member_context.member_id, memberId))
    .limit(1);

  if (rows.length === 0) {
    return [];
  }

  let descriptors: StoredDescriptor[];
  try {
    descriptors = JSON.parse(rows[0].pinned_widgets) as StoredDescriptor[];
    if (!Array.isArray(descriptors)) return [];
  } catch {
    return [];
  }

  // The loaded ontology is the SOURCE of the read-api's structural whitelist
  // (validTypes/validFields/table lookup). Loaded from the runtime ontology dir;
  // changes only on /apply (which restarts the process).
  const ontology = await loadOntology(getRuntimeOntologyDir());

  // Build the read-only api once — passed to ALL bindings.
  // Bindings receive this api, NOT db, so they physically cannot write.
  // SECURITY: the api is gated by the VIEWER's per-type read permission
  // (canReadType) AND its structural whitelist is DERIVED from the loaded
  // ontology — restricted types are safe-empty for unauthorized viewers.
  const api = createReadOnlyDataApi(db, canReadType, ontology);

  // Resolve each descriptor — run READ-ONLY queryBinding
  const resolved: ResolvedWidget[] = [];

  for (const descriptor of descriptors) {
    const kind = descriptor.kind as CatalogKind;
    if (!CATALOG_KINDS.includes(kind)) continue;

    const entry = WIDGET_CATALOG[kind];

    // Re-validate config from storage. On failure DO NOT drop the widget — a
    // stored config that no longer validates is STRUCTURAL DRIFT (a type renamed/
    // removed, a field deleted). Surface it as a data-less error widget so the
    // steward SEES the broken view instead of it silently vanishing (governance
    // over silent mutation).
    const validation = validateWidgetConfig(kind, descriptor.config, ontology);
    if (!validation.ok) {
      resolved.push({
        id: descriptor.id,
        kind,
        config: descriptor.config,
        data: null,
        status: "drift",
        validation_error: describeValidationError(validation),
        title: descriptor.title,
      });
      continue;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await entry.queryBinding(validation.config as any, api);
      resolved.push({
        id: descriptor.id,
        kind,
        config: descriptor.config,
        data,
        status: isEmptyWidgetData(kind, data) ? "empty" : "ok",
        title: descriptor.title,
      });
    } catch (e) {
      console.error(`[widget:${kind}] resolve failed`, e);
      resolved.push({
        id: descriptor.id,
        kind,
        config: descriptor.config,
        data: null,
        status: "error",
        error: { message: "This widget could not be loaded." },
        title: descriptor.title,
      });
    }
  }

  return resolved;
}

// Is a SUCCESSFULLY-resolved widget's data structurally empty? metric kinds are
// never "empty" (a count of 0 is a measurement); collection kinds are empty when
// their backing array/map is empty. Pure — no IO, no ontology. Used by the seam
// to set status:"empty" vs "ok".
export function isEmptyWidgetData(
  kind: CatalogKind,
  data: MetricData | DataTableData | RosterData | CalendarData,
): boolean {
  switch (kind) {
    case "metric":
    case "intelligence_metric":
      return false;
    case "data_table":
      return (data as DataTableData).rows.length === 0;
    case "roster":
      return (data as RosterData).entries.length === 0;
    case "calendar":
      return Object.keys((data as CalendarData).buckets).length === 0;
    default:
      return false;
  }
}
