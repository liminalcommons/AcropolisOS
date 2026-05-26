// Steward/admin org dashboard.
//
// Non-member-scoped: does NOT require a Member row for the actor.
// A fixed admin dashboard config (in-code, no persistence) is resolved
// through the governed widget path: resolveDescriptors → ReadOnlyDataApi →
// WIDGET_CATALOG[kind].queryBinding — same path as the per-user home dashboard.
//
// FENCE: read-only. resolveDescriptors passes a ReadOnlyDataApi (no mutation
// methods) to every queryBinding. This page never writes to the world-model.
//
// AUTH GATE: buildChatRuntime() + isAnonymous(), THEN steward-only.
// The org dashboard is the admin surface (decision: one admin view = steward).
// Role gating matters because the widget read path (ReadOnlyDataApi) is
// permission-blind — it applies only a structural type/field whitelist, NOT the
// viewer's per-type read permissions. Restricting this page to stewards (who are
// authorized for all types) contains that gap until the read path is made
// actor-permission-aware. See the HIGH fix-request in the opponent log.

import Link from "next/link";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { resolveDescriptors } from "@/lib/widgets/per-user";
import { ResolvedWidgetCard } from "@/components/dashboard/ResolvedWidgetCard";
import type { ResolvedWidget } from "@/lib/widgets/compose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Fixed admin dashboard config ──────────────────────────────────────────────
//
// ONE data_table widget over Bed. Columns are every human-useful field in
// CATALOG_VALID_FIELDS["bed"]: code, room, is_bottom_bunk, out_of_service, notes.
// (There is no "status" field on bed — see CATALOG_VALID_FIELDS in catalog.ts.)
// Config shape matches DataTableConfigSchema exactly (type, columns, limit).
//
// This is the "fixed default admin dashboard config" — no persistence layer.
// When agent-driven composition is wired up later, these descriptors will be
// replaced by whatever the steward pins to their member_context.

const ADMIN_DASHBOARD_DESCRIPTORS = [
  {
    id: "admin-bed-list",
    kind: "data_table" as const,
    config: {
      type: "bed" as const,
      columns: ["code", "room", "is_bottom_bunk", "out_of_service", "notes"],
      limit: 100,
    },
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function OrgPage(): Promise<React.ReactElement> {
  // Auth gate — mirrors /day and /me.
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    return (
      <main className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-muted-foreground">
          Sign in to view the org dashboard.{" "}
          <Link href="/signin" className="underline text-foreground">
            Sign in
          </Link>
        </p>
      </main>
    );
  }
  // Steward-only: the admin surface. Contains the permission-blind read path
  // (see AUTH GATE note above) by restricting to actors authorized for all types.
  if (chatRuntime.actor.role !== "steward") {
    return (
      <main className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-muted-foreground">
          The org dashboard is available to stewards only.
        </p>
      </main>
    );
  }

  // Resolve the fixed admin dashboard through the governed widget path.
  // resolveDescriptors validates configs against WIDGET_CATALOG schemas,
  // then calls queryBinding(config, ReadOnlyDataApi) — no raw SQL, no db handle.
  const db = getDb();
  let widgets: ResolvedWidget[] = [];
  try {
    widgets = await resolveDescriptors(db, ADMIN_DASHBOARD_DESCRIPTORS);
  } catch {
    // Non-fatal — renders empty state if resolution fails
  }

  return (
    <main>
      <div className="mx-auto max-w-5xl px-8 py-10 space-y-6">

        {/* Header */}
        <div className="space-y-1">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">
            Org dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Steward view — all beds, rooms, and service status.
          </p>
        </div>

        {/* Section label */}
        <div className="text-xs uppercase tracking-widest text-muted-foreground border-b border-border pb-2">
          Bed inventory
        </div>

        {/* Widget grid — governed catalog widgets via resolveDescriptors */}
        {widgets.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No data available. Seed bed records to populate this view.
            </p>
          </div>
        ) : (
          <section className="space-y-4">
            {widgets.map((w) => (
              <ResolvedWidgetCard key={w.id} widget={w} />
            ))}
          </section>
        )}

        {/* Footer */}
        <p className="text-xs text-muted-foreground pt-4 border-t border-border">
          Read-only view. Data flows through the governed widget catalog (
          <span className="font-mono">data_table</span> over{" "}
          <span className="font-mono">bed</span>
          ) via <span className="font-mono">ReadOnlyDataApi</span>.
        </p>
      </div>
    </main>
  );
}
