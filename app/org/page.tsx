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
// The widget read path is now actor-permission-aware: resolveDescriptors gates
// every read by the session actor's per-type read permission (buildCanReadType,
// fail-closed, same model as ctx.objects). Steward authorization for all types
// still scopes this page, but the read path no longer trusts the page gate
// alone — a restricted type returns safe-empty for any unauthorized viewer.

import Link from "next/link";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { resolveDescriptors } from "@/lib/widgets/per-user";
import { buildCanReadType } from "@/lib/widgets/read-api";
import { readOrgDashboard, adminDefaultBoard } from "@/lib/org-dashboard/store";
import { resolveApprovedViews } from "@/lib/views/resolve";
import { mergeApprovedIntoFloor } from "@/lib/views/merge";
import { PgApprovedViewsRegistry } from "@/lib/views/registry-pg";
import { readOrgProfile } from "@/lib/org-profile/store";
import { OrgNameEditor } from "@/components/org/org-name-editor";
import { ResolvedWidgetCard } from "@/components/dashboard/ResolvedWidgetCard";
import type { ResolvedWidget } from "@/lib/widgets/compose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Org dashboard config ──────────────────────────────────────────────────────
//
// The dashboard descriptors come from the persisted org-dashboard config
// (readOrgDashboard) when the steward has composed something. When nothing is
// stored the page falls back to the DERIVED admin floor (adminDefaultBoard):
// the open-agent_blocker veto-queue, then a count metric + table/calendar per
// readable type — composed from the ontology, no domain literals.
//
// ── Page ──────────────────────────────────────────────────────────────────────

export default async function OrgPage(): Promise<React.ReactElement> {
  // Auth gate — mirrors /me.
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

  // Resolve the org dashboard through the governed widget path: stored steward
  // composition if present, else the DERIVED admin floor. resolveDescriptors
  // validates configs against WIDGET_CATALOG schemas, then calls
  // queryBinding(config, ReadOnlyDataApi) — no raw SQL, no db handle.
  const db = getDb();
  // SECURITY: gate the read path by the steward actor's per-type read permission
  // (fail-closed); the same canReadType also scopes which types the floor admits.
  const canReadType = buildCanReadType(chatRuntime.actor, chatRuntime.ontology);
  let widgets: ResolvedWidget[] = [];
  try {
    // Stored (steward-composed) widgets win; absent → the DERIVED admin floor
    // (veto-queue + per-type metrics/tables), resolved through the same fence.
    const stored = await readOrgDashboard();
    let descriptors: unknown[];
    if (stored.widgets.length > 0) {
      descriptors = stored.widgets;
    } else {
      // No stored steward composition → DERIVED admin floor, then layer any
      // org-scope APPROVED views over it (governed proposal output). Approved
      // views are resolved fail-closed by the steward actor's per-type read
      // permission — the SAME canReadType the render fence enforces below.
      const floor = adminDefaultBoard(chatRuntime.ontology, canReadType);
      const approved = await resolveApprovedViews(
        new PgApprovedViewsRegistry(db),
        { id: chatRuntime.actor.userId, role: chatRuntime.actor.role },
        canReadType,
      );
      descriptors = mergeApprovedIntoFloor(floor, approved);
    }
    widgets = await resolveDescriptors(db, descriptors, canReadType);
  } catch {
    // Non-fatal — renders empty state if resolution fails
  }

  const orgProfile = await readOrgProfile();

  return (
    <main>
      <div className="mx-auto max-w-5xl px-8 py-10 space-y-6">

        {/* Header */}
        <div className="space-y-1">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">
            Org dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Steward view — composed via chat. Ask to add a table, list, or metric
            of any type.
          </p>
        </div>

        {/* Organization identity — steward-editable name shown in the shell */}
        <div className="rounded-lg border border-border bg-card/20 p-4">
          <OrgNameEditor initialName={orgProfile?.name ?? ""} />
        </div>

        {/* Section label */}
        <div className="text-xs uppercase tracking-widest text-muted-foreground border-b border-border pb-2">
          Composed view
        </div>

        {/* Widget grid — governed catalog widgets via resolveDescriptors */}
        {widgets.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No data available. Compose a view in chat or seed records to
              populate this dashboard.
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
          Read-only view. Data flows through the governed widget catalog via{" "}
          <span className="font-mono">ReadOnlyDataApi</span> — composed from the
          ontology, fail-closed per-type read permission.
        </p>
      </div>
    </main>
  );
}
