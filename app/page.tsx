// Home — the composed board IS the surface (no fixed nav tabs).
//
// THE THESIS (ARCHITECTURE §1): board = render(ontology, data, viewer). The same
// derivation, scoped by the viewer's per-type read permissions, produces every
// surface. A steward's home is their composed admin board; a member's home is
// their own ontological slice. A steward can preview any role via ?as=<role>
// (the storyboard's role switch) — the SAME render function, a different viewer.
//
// FENCE (ARCHITECTURE §2/§7): strictly READ-ONLY via ReadOnlyDataApi. This page
// never writes the world-model. The viewer-role override is steward-only and
// enforced here before it reaches buildCanReadType.
//
// SESSION: actor resolved from buildChatRuntime() → never a request param. Only
// the ?as preview role comes from the URL, and only a steward may use it.

import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { member as memberTable } from "@/lib/db/schema.generated";
import { TODAY_LABEL } from "@/lib/me/today";
import {
  resolvePerUserDashboard,
  resolveDescriptors,
} from "@/lib/widgets/per-user";
import { deriveDefaultBoard } from "@/lib/widgets/derive-board";
import { readOrgDashboard, adminDefaultBoard } from "@/lib/org-dashboard/store";
import { resolveApprovedViews } from "@/lib/views/resolve";
import { mergeApprovedIntoFloor } from "@/lib/views/merge";
import { PgApprovedViewsRegistry } from "@/lib/views/registry-pg";
import { buildCanReadType } from "@/lib/widgets/read-api";
import { addableWidgets } from "@/lib/widgets/arrange";
import { readOrgProfile } from "@/lib/org-profile/store";
import { OrgNameEditor } from "@/components/org/org-name-editor";
import { WidgetControls } from "@/components/dashboard/widget-controls";
import { ResolvedWidgetCard } from "@/components/dashboard/ResolvedWidgetCard";
import type { ResolvedWidget } from "@/lib/widgets/compose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function widgetLabel(kind: string, config: unknown): string {
  const c = (config ?? {}) as { type?: string; agg?: string };
  const type = c.type ? c.type.replace(/_/g, " ") : "";
  switch (kind) {
    case "metric":
      return `${c.agg ?? "count"} of ${type || "items"}`;
    case "data_table":
      return `${type || "data"} table`;
    case "roster":
      return `${type || "items"} roster`;
    case "calendar":
      return `${type || "items"} calendar`;
    default:
      return kind;
  }
}

// Shared widget grid — metrics in a responsive row, everything else stacked.
function WidgetGrid({ widgets }: { widgets: ResolvedWidget[] }) {
  const metrics = widgets.filter((w) => w.kind === "metric");
  const others = widgets.filter((w) => w.kind !== "metric");
  return (
    <section className="space-y-4">
      {metrics.length > 0 && (
        <div
          className={`grid gap-4 ${
            metrics.length === 1
              ? "grid-cols-1 max-w-xs"
              : metrics.length === 2
                ? "grid-cols-2"
                : "grid-cols-3"
          }`}
        >
          {metrics.map((w) => (
            <ResolvedWidgetCard key={w.id} widget={w} />
          ))}
        </div>
      )}
      {others.map((w) => (
        <ResolvedWidgetCard key={w.id} widget={w} />
      ))}
    </section>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}): Promise<React.ReactElement> {
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    redirect("/signin");
  }
  const actor = chatRuntime.actor!;
  const ontology = chatRuntime.ontology;
  const db = getDb();
  const isSteward = actor.role === "steward";
  const sp = await searchParams;
  // Only a steward may preview another role's view.
  const requested = isSteward ? sp?.as : undefined;

  // ── Steward home: the composed admin board (folds in the old /org). ─────────
  if (isSteward) {
    const previewing = !!requested && requested !== "steward";
    const effectiveRole = previewing ? (requested as string) : "steward";
    const canReadType = buildCanReadType(
      actor,
      ontology,
      previewing ? (requested as string) : undefined,
    );

    let widgets: ResolvedWidget[] = [];
    try {
      let descriptors: unknown[];
      if (previewing) {
        // Preview another role's slice — the DERIVED board for that lens.
        descriptors = deriveDefaultBoard(ontology, canReadType, { admin: false });
      } else {
        // The steward's own board: stored composition wins, else the derived
        // admin floor (veto-queue + per-type metrics/tables) + org approved views.
        const stored = await readOrgDashboard();
        if (stored.widgets.length > 0) {
          descriptors = stored.widgets;
        } else {
          const floor = adminDefaultBoard(ontology, canReadType);
          const approved = await resolveApprovedViews(
            new PgApprovedViewsRegistry(db),
            { id: actor.userId, role: actor.role },
            canReadType,
          );
          descriptors = mergeApprovedIntoFloor(floor, approved);
        }
      }
      widgets = await resolveDescriptors(db, descriptors, canReadType);
    } catch {
      // Non-fatal — renders empty state if resolution fails.
    }

    const orgProfile = await readOrgProfile();

    return (
      <div className="font-sans">
        <div className="mx-auto max-w-5xl px-8 py-10 space-y-6">
          <div className="space-y-1">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">
              Home
            </h1>
            <p className="text-sm text-muted-foreground">
              {previewing
                ? `Previewing the ${effectiveRole} view — the board composed from the ontology for that role.`
                : "Your composed board. Ask the agent in chat to add a table, list, or metric of any type."}
            </p>
          </div>

          {previewing ? (
            <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
              Viewing as <span className="font-medium">{effectiveRole}</span>.{" "}
              <Link href="/" className="underline hover:text-amber-200">
                Back to your board
              </Link>
            </p>
          ) : (
            <div className="rounded-lg border border-border bg-card/20 p-4">
              <OrgNameEditor initialName={orgProfile?.name ?? ""} />
            </div>
          )}

          <div className="text-xs uppercase tracking-widest text-muted-foreground border-b border-border pb-2">
            {previewing ? `${effectiveRole} · slice` : "Composed view"}
          </div>

          {widgets.length === 0 ? (
            <div className="rounded-lg border border-border bg-card/20 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                {previewing
                  ? `Nothing the ${effectiveRole} role can read yet.`
                  : "No widgets yet. Ask the agent in chat to add one, or seed records."}
              </p>
            </div>
          ) : (
            <WidgetGrid widgets={widgets} />
          )}

          <p className="text-xs text-muted-foreground pt-4 border-t border-border">
            Read-only view. Data flows through the governed widget catalog —
            composed from the ontology, fail-closed per-type read permission.
          </p>
        </div>
      </div>
    );
  }

  // ── Member home: this member's own ontological slice (pins + derived). ──────
  const memberRows = await db
    .select({
      id: memberTable.id,
      full_name: memberTable.full_name,
      email: memberTable.email,
      tier_role: memberTable.tier_role,
    })
    .from(memberTable)
    .where(eq(memberTable.id, actor.userId))
    .limit(1);

  if (memberRows.length === 0) {
    return (
      <main className="flex min-h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No Member row found for your account. Contact a steward.
        </p>
      </main>
    );
  }

  const me = memberRows[0];
  const canReadType = buildCanReadType(actor, ontology);
  let widgets: ResolvedWidget[] = [];
  try {
    widgets = await resolvePerUserDashboard(
      db,
      { id: me.id, tier_role: me.tier_role },
      canReadType,
      new PgApprovedViewsRegistry(db),
    );
  } catch {
    // Non-fatal — renders empty dashboard if resolution fails.
  }

  return (
    <div className="font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {me.full_name}{" "}
            <span className="text-muted-foreground font-normal">·</span>{" "}
            <span className="text-muted-foreground font-normal text-base">
              {me.tier_role}
            </span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{TODAY_LABEL}</p>
        </div>

        <div className="text-xs uppercase tracking-widest text-muted-foreground border-b border-border pb-2">
          Your ontological slice · {me.tier_role}
        </div>

        <WidgetControls
          widgets={widgets.map((w) => ({
            id: w.id,
            label: widgetLabel(w.kind, w.config),
          }))}
          addable={addableWidgets(ontology, canReadType).map((s, index) => ({
            index,
            label: widgetLabel(s.kind, s.config),
          }))}
        />

        {widgets.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No widgets available for what you can currently read.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Ask the agent in chat to add a widget.
            </p>
          </div>
        ) : (
          <WidgetGrid widgets={widgets} />
        )}

        <section>
          <Link
            href="/organize"
            className="block rounded-lg border border-dashed border-border/60 p-4 hover:border-border/80 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="text-muted-foreground text-sm mt-0.5">⊞</span>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Organize raw inbox
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 italic">
                  Let the agent classify inbound messy data into typed objects
                </p>
              </div>
            </div>
          </Link>
        </section>
      </div>
    </div>
  );
}
