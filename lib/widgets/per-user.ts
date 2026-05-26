// V3: per-user ontological dashboard.
//
// ARCHITECTURE §1 thesis: "every user has their own ontological awareness" —
// the same code composes DIFFERENT dashboards depending on the member's
// tier_role (their ontological slice of the world-model).
//
// ARCHITECTURE §7 fence: resolvePerUserDashboard is strictly READ-ONLY.
// It calls resolveDashboard() which passes a ReadOnlyDataApi to every
// queryBinding — no mutation method exists on that type.
//
// Role → slice mapping:
//   manager   : org-wide overview (guest count + member count + member roster)
//   supervisor : operational view (guest count + shift roster + guest table)
//   staff      : operational / front-desk (guest table + shift roster)
//   work_trader: their own slice (shift roster + work_trade_agreement table)
//
// Precedence: explicit non-empty pinned_widgets > role default (SLICE_SPEC).
// memberId/role are ALWAYS derived from the session member row — never a param.

import { eq } from "drizzle-orm";
import { member_context } from "@/lib/db/schema.generated";
import type { Database } from "@/lib/db/client";
import {
  WIDGET_CATALOG,
  validateWidgetConfig,
  type CatalogKind,
  type MetricData,
  type DataTableData,
  type RosterData,
  type CalendarData,
} from "./catalog";
import { createReadOnlyDataApi, type CanReadType } from "./read-api";
import { compose_dashboard, type ResolvedWidget } from "./compose";
import { resolveRefLabels } from "./resolve-refs";
import { oneClickRowActionsForType } from "./row-actions";
import type { CatalogType } from "./catalog";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import type { Ontology } from "@/lib/ontology/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

// The ontological tier_role values from member.tier_role in the DB.
// Maps to roles.yaml: manager | supervisor | staff | work_trader
// Plus a catch-all for unknown values.
export type TierRole = "manager" | "supervisor" | "staff" | "work_trader";

// A descriptor for a widget in a role's default slice.
// Matches the StoredDescriptor shape inside compose.ts (kind + config).
export interface SliceDescriptor {
  kind: CatalogKind;
  config: unknown;
}

// ── SLICE_SPEC ─────────────────────────────────────────────────────────────────
//
// Per-role default widget sets. These are GENUINELY DIFFERENT:
//   manager:    org-wide (total guests, total members, member roster)
//   supervisor: operations (guest count, today's shifts, guest table)
//   staff:      front-desk (guest table, open shifts)
//   work_trader: their own slice (shifts, work_trade_agreements)
//
// Each entry is a validated config for an existing catalog kind.
// The read-only api enforces type+field whitelists at query time.

export const SLICE_SPEC: Record<TierRole, SliceDescriptor[]> = {
  // Manager: org-wide overview
  manager: [
    {
      kind: "metric",
      config: { type: "guest", agg: "count" },
    },
    {
      kind: "metric",
      config: { type: "member", agg: "count" },
    },
    {
      kind: "data_table",
      config: {
        type: "member",
        columns: ["full_name", "email", "tier_role", "started_at"],
        limit: 20,
      },
    },
  ],

  // Supervisor: operational — guests + shifts + guest table
  supervisor: [
    {
      kind: "metric",
      config: { type: "guest", agg: "count" },
    },
    {
      kind: "roster",
      config: {
        type: "shift",
        fields: ["label", "kind", "starts_at", "status"],
        limit: 10,
      },
    },
    {
      kind: "data_table",
      config: {
        type: "guest",
        columns: ["full_name", "email", "current_status", "arrived_at"],
        limit: 15,
      },
    },
  ],

  // Staff: front-desk — today's guests + open shifts
  staff: [
    {
      kind: "data_table",
      config: {
        type: "guest",
        columns: ["full_name", "country", "current_status", "expected_departure"],
        limit: 20,
      },
    },
    {
      kind: "roster",
      config: {
        type: "shift",
        fields: ["label", "kind", "starts_at", "duration_hours", "status"],
        limit: 10,
      },
    },
  ],

  // Work-trader: their own slice — shifts + agreements
  work_trader: [
    {
      kind: "roster",
      config: {
        type: "shift",
        fields: ["label", "kind", "starts_at", "duration_hours", "status"],
        limit: 20,
      },
    },
    {
      kind: "data_table",
      config: {
        type: "work_trade_agreement",
        columns: ["label", "hours_per_week", "start_date", "end_date", "status"],
        limit: 10,
      },
    },
  ],
};

// ── resolvePerUserDashboard ───────────────────────────────────────────────────
//
// THE CONTRACT:
//   1. If the member has explicit non-empty pinned_widgets → use those (explicit > default).
//   2. Else → compose from SLICE_SPEC[member.tier_role] (role default).
//   3. Run the descriptors through the V2 read-only ReadOnlyDataApi.
//   4. Returns a rendered bundle (same shape as resolveDashboard).
//
// FENCE: calls createReadOnlyDataApi (no mutation methods). Never writes.
// SESSION: memberId and tier_role come from the caller who resolved them from
// the session (buildChatRuntime → actor.userId → member row). Never derived
// from a request param inside this function.

export async function resolvePerUserDashboard(
  db: Database,
  member: { id: string; tier_role: string },
  canReadType: CanReadType,
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
      // fall through to the SLICE_SPEC role default so the member always sees
      // SOMETHING. Role default is the floor, not a blank "No widgets configured".
    }
  }

  // 2. No explicit pinned_widgets → compose from SLICE_SPEC[tier_role]
  const role = (member.tier_role as TierRole) in SLICE_SPEC
    ? (member.tier_role as TierRole)
    : "staff"; // unknown role falls back to staff slice

  const spec = SLICE_SPEC[role];
  return runDescriptors(db, spec, canReadType);
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
  // SECURITY: the api is gated by the VIEWER's per-type read permission.
  // A widget bound to a restricted type (e.g. booking) returns safe-empty for
  // a viewer not permitted to read it — fail-closed, before any SQL.
  const api = createReadOnlyDataApi(db, canReadType);
  // Ontology drives REF-LABEL resolution (which columns are FKs, target's
  // title_property). Loaded once per call (cached across calls — disk reads are
  // non-trivial and the ontology only changes on /apply, which restarts the
  // process). REUSES the same `api` (same canReadType) for fetching target
  // labels, so resolution is fail-closed on the TARGET type's read permission.
  const ontology = await getRenderOntologyCached();
  const resolved: ResolvedWidget[] = [];

  for (let i = 0; i < descriptors.length; i++) {
    const raw = descriptors[i];
    if (!raw || typeof raw !== "object") continue;

    const d = raw as { id?: string; kind?: unknown; config?: unknown };
    const kindRaw = d.kind;
    if (typeof kindRaw !== "string") continue;

    // Validate kind
    const CATALOG_KINDS = ["metric", "data_table", "roster", "calendar"] as const;
    if (!(CATALOG_KINDS as readonly string[]).includes(kindRaw)) continue;
    const kind = kindRaw as CatalogKind;

    const entry = WIDGET_CATALOG[kind];
    const config = d.config ?? {};

    // Validate config
    const validation = validateWidgetConfig(kind, config);
    if (!validation.ok) continue;

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
      if (kind === "data_table") {
        const cfg = validation.config as {
          type: CatalogType;
          row_actions?: boolean;
        };
        if (cfg.row_actions === true) {
          const derived = oneClickRowActionsForType(cfg.type, ontology);
          if (derived.length > 0) rowActions = derived;
        }
      }
      resolved.push({
        id: d.id ?? `role-default-${i}`,
        kind,
        config,
        data: resolvedData as MetricData | DataTableData | RosterData | CalendarData,
        title: (d as { title?: string }).title,
        ...(rowActions ? { rowActions } : {}),
      });
    } catch {
      // Skip widgets whose binding throws — don't crash the dashboard
    }
  }

  return resolved;
}

// ── REF-LABEL resolution wiring ──────────────────────────────────────────────
//
// data_table → resolve over config.columns, rewrite data.rows.
// roster      → resolve over config.fields,  rewrite data.entries.
// metric/calendar → no column-based ref values; returned unchanged.

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

// ── composeTierRoleDefault ────────────────────────────────────────────────────
//
// Helper for the proof script (and for seeding): persists the SLICE_SPEC
// for a given tier_role to a member's pinned_widgets. NOT called by the
// dashboard page (it uses SLICE_SPEC directly without writing).

export async function composeTierRoleDefault(
  db: Database,
  memberId: string,
  tierRole: TierRole,
): Promise<void> {
  const spec = SLICE_SPEC[tierRole];
  if (!spec) return;

  const selections = spec.map((d) => ({ kind: d.kind, config: d.config }));
  await compose_dashboard(db, memberId, selections);
}

// ── resolveDescriptors (public alias) ─────────────────────────────────────────
//
// Promotes the internal runDescriptors to a named export.
// Steward/admin surfaces (e.g. /org) call this with a fixed in-code descriptor
// list to resolve widgets without needing a member_context row — same
// read-only api path as resolvePerUserDashboard, no persistence involved.
export { runDescriptors as resolveDescriptors };
