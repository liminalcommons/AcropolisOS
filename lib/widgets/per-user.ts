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
import { createReadOnlyDataApi } from "./read-api";
import { compose_dashboard, type ResolvedWidget } from "./compose";

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
      const pinned = await runDescriptors(db, stored);
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
  return runDescriptors(db, spec);
}

// ── Internal: run a list of descriptors through the read-only api ─────────────
//
// Validates each descriptor config and calls queryBinding via ReadOnlyDataApi.
// This is the same logic as resolveDashboard() in compose.ts — kept here so
// resolvePerUserDashboard doesn't need to write to member_context first.

async function runDescriptors(
  db: Database,
  descriptors: unknown[],
): Promise<ResolvedWidget[]> {
  const api = createReadOnlyDataApi(db);
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
      resolved.push({
        id: d.id ?? `role-default-${i}`,
        kind,
        config,
        data: data as MetricData | DataTableData | RosterData | CalendarData,
      });
    } catch {
      // Skip widgets whose binding throws — don't crash the dashboard
    }
  }

  return resolved;
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
