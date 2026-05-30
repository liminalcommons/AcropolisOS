// Per-user ontological dashboard — the PERMISSION-LENS model.
//
// THE THESIS (ARCHITECTURE §1): every user has their own ontological awareness.
// The default board is DERIVED from the loaded ontology (deriveDefaultBoard) and
// scoped by the viewer's per-type read permissions. A role sees a different slice
// ONLY because canReadType admits different types — not because of a hand-curated
// per-role list. Same derivation, different lens.
//
// FENCE (ARCHITECTURE §2/§7): resolvePerUserDashboard is strictly READ-ONLY.
// The page never writes to the world-model — only reads via the read-only api.
//
// SESSION: member resolved from buildChatRuntime() → actor.userId → member row.
// NEVER from a request param. memberId is session-derived only; tier_role is used
// only as a display label.

import Link from "next/link";
import { redirect } from "next/navigation";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { member as memberTable } from "@/lib/db/schema.generated";
import { eq } from "drizzle-orm";
import { TODAY_LABEL } from "@/lib/me/today";
import { resolvePerUserDashboard } from "@/lib/widgets/per-user";
import { buildCanReadType } from "@/lib/widgets/read-api";
import { addableWidgets } from "@/lib/widgets/arrange";
import { WidgetControls } from "@/components/dashboard/widget-controls";
import { ResolvedWidgetCard } from "@/components/dashboard/ResolvedWidgetCard";
import type { ResolvedWidget } from "@/lib/widgets/compose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Page ──────────────────────────────────────────────────────────────────────

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

export default async function Home(): Promise<React.ReactElement> {
  // Auth guard — middleware enforces this; defense-in-depth for direct calls.
  // SESSION IS THE ONLY SOURCE OF TRUTH for memberId and role (V3 contract).
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    redirect("/signin");
  }

  // Resolve Member row for the session actor.
  // actor.userId is the member.id — never derived from a request param.
  const actor = chatRuntime.actor!;
  const db = getDb();

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

  // Compose THIS member's ontological slice.
  // resolvePerUserDashboard derives the default board from the ontology, scoped
  // by the viewer's read permissions (permission-lens) — unless explicit
  // pinned_widgets are set, in which case those take precedence.
  // FENCE: read-only via ReadOnlyDataApi — no writes.
  // SECURITY: gate the widget read path by the session actor's per-type read
  // permission (fail-closed). Built from the SAME source as ctx.objects.
  const canReadType = buildCanReadType(actor, chatRuntime.ontology);
  let widgets: ResolvedWidget[] = [];
  try {
    widgets = await resolvePerUserDashboard(db, {
      id: me.id,
      tier_role: me.tier_role,
    }, canReadType);
  } catch {
    // Non-fatal — renders empty dashboard if resolution fails
  }

  return (
    <div className="font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">

        {/* Header */}
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

        {/* Role slice label */}
        <div className="text-xs uppercase tracking-widest text-muted-foreground border-b border-border pb-2">
          Your ontological slice · {me.tier_role}
        </div>

        {/* Arrangement controls — Tier-2: arrange within your permission-scoped catalog */}
        <WidgetControls
          widgets={widgets.map((w) => ({ id: w.id, label: widgetLabel(w.kind, w.config) }))}
          addable={addableWidgets(chatRuntime.ontology, canReadType).map((s, index) => ({
            index,
            label: widgetLabel(s.kind, s.config),
          }))}
        />

        {/* Widget grid — per-user ontological slice */}
        {widgets.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No widgets available for what you can currently read.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Ask the agent to add a widget below.
            </p>
          </div>
        ) : (
          <section className="space-y-4">
            {/* Metric widgets in a responsive grid */}
            {(() => {
              const metrics = widgets.filter((w) => w.kind === "metric");
              const others = widgets.filter((w) => w.kind !== "metric");
              return (
                <>
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
                </>
              );
            })()}
          </section>
        )}

        {/* Ask agent affordance */}
        <section>
          <Link
            href="/dashboard/ask"
            className="block rounded-lg border border-dashed border-border p-4 hover:border-border/80 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="text-muted-foreground text-sm mt-0.5">⌗</span>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  + Ask the agent to add a widget
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 italic">
                  e.g. &quot;show me tonight&apos;s check-ins&quot; or &quot;pin kitchen stock levels&quot;
                </p>
              </div>
            </div>
          </Link>
        </section>

        {/* Organize raw inbox */}
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
