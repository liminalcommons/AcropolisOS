// Per-user ontological dashboard — the PERMISSION-LENS model.
//
// ARCHITECTURE §1 thesis: "every user has their own ontological awareness."
// The default board is DERIVED from the loaded ontology via deriveDefaultBoard
// (lib/widgets/derive-board.ts) — there is NO hand-curated per-role widget list.
// A role sees fewer or more widgets ONLY because the viewer's canReadType admits
// fewer or more types: the same derivation, scoped by read permission. The role
// itself is not branched on.
//
// ARCHITECTURE §7 fence: resolvePerUserDashboard is strictly READ-ONLY.
// It runs every descriptor through a ReadOnlyDataApi (createReadOnlyDataApi) —
// no mutation method exists on that type.
//
// Precedence: explicit non-empty pinned_widgets > derived default floor.
// memberId is ALWAYS derived from the session member row — never a param.

import { eq } from "drizzle-orm";
import { member_context } from "@/lib/db/schema.generated";
import type { Database } from "@/lib/db/client";
import {
  WIDGET_CATALOG,
  CATALOG_KINDS,
  validateWidgetConfig,
  describeValidationError,
  type CatalogKind,
  type MetricData,
  type DataTableData,
  type RosterData,
  type CalendarData,
} from "./catalog";
import { createReadOnlyDataApi, type CanReadType } from "./read-api";
import { isEmptyWidgetData, type ResolvedWidget } from "./compose";
import { deriveDefaultBoard } from "./derive-board";
import { resolveApprovedViews } from "@/lib/views/resolve";
import { mergeApprovedIntoFloor } from "@/lib/views/merge";
import type { ApprovedViewsRegistry } from "@/lib/views/registry";
import { resolveRefLabels } from "./resolve-refs";
import { oneClickRowActionsForType } from "./row-actions";
import { resolversForType, type RowResolver } from "./row-resolver";
import { confirmsForType, type RowConfirm } from "./row-confirm";
import type { CatalogType } from "./catalog";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import type { Ontology } from "@/lib/ontology/schema";

// ── resolvePerUserDashboard ───────────────────────────────────────────────────
//
// THE CONTRACT:
//   1. If the member has explicit non-empty pinned_widgets → use those (explicit > default).
//   2. Else → DERIVE the default floor from the ontology via deriveDefaultBoard,
//      scoped by the viewer's canReadType (permission-lens). No per-role list.
//   3. Run the descriptors through the read-only ReadOnlyDataApi.
//   4. Returns a rendered bundle (same shape as resolveDashboard).
//
// FENCE: calls createReadOnlyDataApi (no mutation methods). Never writes.
// SESSION: memberId comes from the caller who resolved it from the session
// (buildChatRuntime → actor.userId → member row). Never derived from a request
// param inside this function. tier_role is carried for UI labelling only — it is
// NOT used to branch the board; differentiation is entirely via canReadType.

export async function resolvePerUserDashboard(
  db: Database,
  member: { id: string; tier_role: string },
  canReadType: CanReadType,
  registry: ApprovedViewsRegistry,
): Promise<ResolvedWidget[]> {
  // 1. Check for explicit pinned_widgets in member_context
  const rows = await db
    .select({ pinned_widgets: member_context.pinned_widgets })
    .from(member_context)
    .where(eq(member_context.member_id, member.id))
    .limit(1);

  // Parse stored pinned_widgets
  if (rows.length > 0) {
    const raw = rows[0].pinned_widgets;
    let stored: unknown[] | null = null;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        stored = parsed;
      }
    } catch {
      // Corrupt JSON — fall through to role default
    }

    if (stored && stored.length > 0) {
      // Explicit pinned_widgets exist — run them through the read-only api.
      // This mirrors resolveDashboard's logic exactly (same machinery, reuse path).
      const pinned = await runDescriptors(db, stored, canReadType);
      if (pinned.length > 0) {
        // At least one valid widget → return the valid set (partial-invalid is fine).
        return pinned;
      }
      // All pinned configs stale/invalid (zero valid after validateWidgetConfig) →
      // fall through to the derived default so the member always sees SOMETHING.
      // The derived board is the floor, not a blank "No widgets configured".
    }
  }

  // 2. No explicit pinned_widgets → DERIVE the floor from the ontology,
  //    permission-scoped. Role differentiation is entirely via canReadType
  //    (the viewer's readable types), not a hand-curated per-role list.
  //    Then merge steward-APPROVED views OVER the floor (precedence:
  //    floor < approved < pins — pins already short-circuited above). The
  //    approved set is itself fail-closed by canReadType in resolveApprovedViews.
  const ontology = await getRenderOntologyCached();
  const floor = deriveDefaultBoard(ontology, canReadType);
  const approved = await resolveApprovedViews(
    registry,
    { id: member.id, role: member.tier_role },
    canReadType,
  );
  const merged = mergeApprovedIntoFloor(floor, approved);
  return runDescriptors(db, merged, canReadType);
}

// ── Internal: run a list of descriptors through the read-only api ─────────────
//
// Validates each descriptor config and calls queryBinding via ReadOnlyDataApi.
// This is the same logic as resolveDashboard() in compose.ts — kept here so
// resolvePerUserDashboard doesn't need to write to member_context first.

async function runDescriptors(
  db: Database,
  descriptors: unknown[],
  canReadType: CanReadType,
): Promise<ResolvedWidget[]> {
  // Ontology drives BOTH the read-api's structural whitelist (validTypes/
  // validFields/table lookup) AND REF-LABEL resolution (which columns are FKs,
  // target's title_property). Loaded once per call (cached across calls — disk
  // reads are non-trivial and the ontology only changes on /apply, which restarts
  // the process).
  const ontology = await getRenderOntologyCached();
  // SECURITY: the api is gated by the VIEWER's per-type read permission AND its
  // structural whitelist is DERIVED from this loaded ontology. A widget bound to a
  // restricted type returns safe-empty for a viewer not permitted to
  // read it — fail-closed, before any SQL. REUSES the same `api` for fetching
  // target labels, so resolution is fail-closed on the TARGET type's read permission.
  const api = createReadOnlyDataApi(db, canReadType, ontology);
  const resolved: ResolvedWidget[] = [];

  for (let i = 0; i < descriptors.length; i++) {
    const raw = descriptors[i];
    if (!raw || typeof raw !== "object") continue;

    const d = raw as { id?: string; kind?: unknown; config?: unknown };
    const kindRaw = d.kind;
    if (typeof kindRaw !== "string") continue;

    // Validate kind against the CANONICAL catalog kinds (incl. intelligence_metric).
    // A local hand-listed subset here previously omitted intelligence_metric and
    // silently dropped the steward board's KPI widgets — derive the gate from the
    // catalog so it can never drift from WIDGET_CATALOG again.
    if (!(CATALOG_KINDS as readonly string[]).includes(kindRaw)) continue;
    const kind = kindRaw as CatalogKind;

    const entry = WIDGET_CATALOG[kind];
    const config = d.config ?? {};

    // Validate config — membership + field whitelist come from the loaded ontology.
    // On failure DO NOT drop the widget: a stored/derived config that no longer
    // validates is STRUCTURAL DRIFT (type renamed/removed, field deleted). Surface
    // it as a data-less error widget so the steward SEES the broken view instead
    // of it silently vanishing (governance over silent mutation).
    const validation = validateWidgetConfig(kind, config, ontology);
    if (!validation.ok) {
      resolved.push({
        id: d.id ?? `derived-${i}`,
        kind,
        config,
        data: null,
        status: "drift",
        validation_error: describeValidationError(validation),
        title: (d as { title?: string }).title,
      });
      continue;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await entry.queryBinding(validation.config as any, api);
      // REF-LABEL resolution: rewrite FK-UUID columns to the target's label.
      // Only column-based widgets (data_table/roster) carry ref columns; the
      // resolver reuses `api` (fail-closed on the TARGET type's read permission)
      // so an unreadable target leaves the raw UUID in place — no leak.
      const resolvedData = await applyRefResolution(
        kind,
        validation.config,
        data,
        ontology,
        api,
      );
      // DERIVED row actions: only for data_table descriptors opted in via
      // config.row_actions. The actions come from the ontology shape
      // (oneClickRowActionsForType), never a per-type literal. Empty/undefined
      // for every other widget → the card renders exactly as before.
      let rowActions: ResolvedWidget["rowActions"];
      let rowResolvers: RowResolver[] | undefined;
      let rowConfirms: RowConfirm[] | undefined;
      if (kind === "data_table") {
        const cfg = validation.config as {
          type: CatalogType;
          row_actions?: boolean;
        };
        if (cfg.row_actions === true) {
          const derived = oneClickRowActionsForType(cfg.type, ontology);
          if (derived.length > 0) rowActions = derived;
          // A resolver is just another affordance gated by the SAME opt-in:
          // the per-row CHOICE picker (e.g. resolve_blocker_with_pathway). The
          // choices themselves come from each row's choicesFrom column at render.
          const derivedResolvers = resolversForType(cfg.type, ontology);
          if (derivedResolvers.length > 0) rowResolvers = derivedResolvers;
          // The THIRD affordance, SAME opt-in: the per-row BINARY CONFIRM
          // (e.g. resolve_blocker_with_custom). The label/action come from each
          // row's `source` column at render; the invocation is server-derived.
          const derivedConfirms = confirmsForType(cfg.type, ontology);
          if (derivedConfirms.length > 0) rowConfirms = derivedConfirms;
        }
      }
      resolved.push({
        id: d.id ?? `derived-${i}`,
        kind,
        config,
        data: resolvedData as MetricData | DataTableData | RosterData | CalendarData,
        status: isEmptyWidgetData(
          kind,
          resolvedData as MetricData | DataTableData | RosterData | CalendarData,
        ) ? "empty" : "ok",
        title: (d as { title?: string }).title,
        ...(rowActions ? { rowActions } : {}),
        ...(rowResolvers ? { rowResolvers } : {}),
        ...(rowConfirms ? { rowConfirms } : {}),
      });
    } catch (e) {
      // A single widget's data binding threw (transient DB error, bad cast). Do
      // NOT drop it (silent vanish) and do NOT let it nuke the whole board:
      // surface a status:"error" widget so the failure is VISIBLE and ISOLATED.
      // The raw error is logged server-side ONLY — never sent to the client.
      console.error(`[widget:${kind}] resolve failed`, e);
      resolved.push({
        id: d.id ?? `derived-${i}`,
        kind,
        config,
        data: null,
        status: "error",
        error: { message: "This widget could not be loaded." },
        title: (d as { title?: string }).title,
      });
    }
  }

  return resolved;
}

// ── REF-LABEL resolution wiring ──────────────────────────────────────────────
//
// data_table → resolve over config.columns, rewrite data.rows.
// roster      → resolve over config.fields,  rewrite data.entries.
// metric/calendar → no column-based ref values; returned unchanged.
//
// HIDDEN-COLUMN INVARIANT (regression safeguard — see
// lib/widgets/derive-board.ts rowActionColumns + the "row-action column hygiene
// across kinds" suite in derive-board.test.ts): the row-affordance columns
// (row id, each resolver's choicesFrom, each confirm's source) are requested in
// config.columns ONLY so the Dismiss/pathway/confirm affordances can read them.
// They are NOT visible table data — the renderer strips them. This resolver must
// therefore never PROMOTE a hidden column into visible output, and any future
// kind that opts into row_actions (roster/calendar) inherits the same contract:
// hidden columns stay hidden, identically across kinds.

async function applyRefResolution(
  kind: CatalogKind,
  config: unknown,
  data: unknown,
  ontology: Ontology,
  api: ReturnType<typeof createReadOnlyDataApi>,
): Promise<unknown> {
  if (kind === "data_table") {
    const cfg = config as { type: string; columns: string[] };
    const d = data as DataTableData;
    const rows = await resolveRefLabels(d.rows, cfg.type, cfg.columns, ontology, api);
    return { ...d, rows } satisfies DataTableData;
  }
  if (kind === "roster") {
    const cfg = config as { type: string; fields: string[] };
    const d = data as RosterData;
    const entries = await resolveRefLabels(d.entries, cfg.type, cfg.fields, ontology, api);
    return { ...d, entries } satisfies RosterData;
  }
  return data;
}

// Lazily-cached ontology for the render path. Mirrors chat-runtime's cache:
// disk reads are non-trivial and the ontology only changes on /apply (which
// restarts the process). Keyed by dir so a changed ACROPOLISOS_ONTOLOGY_DIR
// (tests) reloads rather than serving a stale cache.
let cachedRenderOntology: Ontology | null = null;
let cachedRenderOntologyDir: string | null = null;

async function getRenderOntologyCached(): Promise<Ontology> {
  const dir = getRuntimeOntologyDir();
  if (cachedRenderOntology && cachedRenderOntologyDir === dir) {
    return cachedRenderOntology;
  }
  const ontology = await loadOntology(dir);
  cachedRenderOntology = ontology;
  cachedRenderOntologyDir = dir;
  return ontology;
}

// ── resolveDescriptors (public alias) ─────────────────────────────────────────
//
// Promotes the internal runDescriptors to a named export.
// Steward/admin surfaces (e.g. /org) call this with a fixed in-code descriptor
// list to resolve widgets without needing a member_context row — same
// read-only api path as resolvePerUserDashboard, no persistence involved.
export { runDescriptors as resolveDescriptors };
