// V3: per-user ontological dashboard.
//
// THE THESIS (ARCHITECTURE §1): every user has their own ontological awareness.
// The same code composes a DIFFERENT dashboard depending on the member's
// tier_role (their ontological slice). Steward/manager sees org-wide overview;
// staff/supervisor sees operational slice; work_trader sees their own slice.
//
// FENCE (ARCHITECTURE §2/§7): resolvePerUserDashboard is strictly READ-ONLY.
// The page never writes to the world-model — only reads via the V2 read-only api.
//
// SESSION: member resolved from buildChatRuntime() → actor.userId → member row.
// NEVER from a request param. memberId/role are session-derived only.
//
// Replaces: the hardcoded "Hostal Solana manager dashboard" (F5) that showed
// the same Daniyar no-show / Sofía WTA / bed grid / open shift to every user.

import Link from "next/link";
import { redirect } from "next/navigation";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { member as memberTable } from "@/lib/db/schema.generated";
import { eq } from "drizzle-orm";
import { TODAY_LABEL } from "@/lib/me/today";
import { resolvePerUserDashboard } from "@/lib/widgets/per-user";
import { addableForRole } from "@/lib/widgets/arrange";
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

  // V3: compose THIS member's ontological slice.
  // resolvePerUserDashboard uses SLICE_SPEC[me.tier_role] (role default)
  // unless explicit pinned_widgets are set — in which case those take precedence.
  // FENCE: read-only via V2 ReadOnlyDataApi — no writes.
  let widgets: ResolvedWidget[] = [];
  try {
    widgets = await resolvePerUserDashboard(db, {
      id: me.id,
      tier_role: me.tier_role,
    });
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

        {/* Arrangement controls — Tier-2: arrange within the role's catalog */}
        <WidgetControls
          widgets={widgets.map((w) => ({ id: w.id, label: widgetLabel(w.kind, w.config) }))}
          addable={addableForRole(me.tier_role).map((s, index) => ({
            index,
            label: widgetLabel(s.kind, s.config),
          }))}
        />

        {/* Widget grid — per-user ontological slice */}
        {widgets.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No widgets configured for your role ({me.tier_role}).
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
