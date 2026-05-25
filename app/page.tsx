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
import type { ResolvedWidget } from "@/lib/widgets/compose";
import type {
  MetricData,
  DataTableData,
  RosterData,
  CalendarData,
} from "@/lib/widgets/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Widget renderer components ─────────────────────────────────────────────────

function MetricWidget({ widget }: { widget: ResolvedWidget }) {
  const data = widget.data as MetricData;
  const config = widget.config as { type: string; agg: string; filter?: { field: string; value: string } };
  const label = config.filter
    ? `${config.type} (${config.filter.field}=${config.filter.value})`
    : config.type;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
        {label}
      </p>
      <p className="text-4xl font-bold tabular-nums text-foreground">
        {data.value}
      </p>
      <p className="text-xs text-muted-foreground mt-1">{config.agg}</p>
    </div>
  );
}

function DataTableWidget({ widget }: { widget: ResolvedWidget }) {
  const data = widget.data as DataTableData;
  const config = widget.config as { type: string; columns: string[]; limit?: number };

  if (data.rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          {config.type}
        </p>
        <p className="text-xs text-muted-foreground">No rows.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
        {config.type}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground text-left">
              {data.columns.map((col) => (
                <th key={col} className="font-normal pb-2 pr-4">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-foreground">
            {data.rows.map((row, i) => (
              <tr
                key={i}
                className={i > 0 ? "border-t border-border/60" : ""}
              >
                {data.columns.map((col) => (
                  <td key={col} className="py-1 pr-4 align-top">
                    {row[col] != null ? String(row[col]) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RosterWidget({ widget }: { widget: ResolvedWidget }) {
  const data = widget.data as RosterData;
  const config = widget.config as { type: string; fields: string[]; limit?: number };

  if (data.entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          {config.type} roster
        </p>
        <p className="text-xs text-muted-foreground">No entries.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
        {config.type} roster
      </p>
      <ul className="space-y-2">
        {data.entries.map((entry, i) => (
          <li
            key={i}
            className={`text-xs ${i > 0 ? "pt-2 border-t border-border/60" : ""}`}
          >
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {data.fields.map((f) => (
                <span key={f} className="text-muted-foreground">
                  <span className="text-muted-foreground/60">{f}:</span>{" "}
                  <span className="text-foreground">
                    {entry[f] != null ? String(entry[f]) : "—"}
                  </span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CalendarWidget({ widget }: { widget: ResolvedWidget }) {
  const data = widget.data as CalendarData;
  const config = widget.config as { type: string; date_field: string };

  const bucketKeys = Object.keys(data.buckets).sort();

  if (bucketKeys.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          {config.type} calendar
        </p>
        <p className="text-xs text-muted-foreground">No events.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
        {config.type} calendar ({config.date_field})
      </p>
      <ul className="space-y-2">
        {bucketKeys.slice(0, 10).map((date) => (
          <li key={date} className="text-xs">
            <span className="text-muted-foreground font-mono">{date}</span>{" "}
            <span className="text-muted-foreground">
              {data.buckets[date].length} item
              {data.buckets[date].length !== 1 ? "s" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WidgetCard({ widget }: { widget: ResolvedWidget }) {
  switch (widget.kind) {
    case "metric":
      return <MetricWidget widget={widget} />;
    case "data_table":
      return <DataTableWidget widget={widget} />;
    case "roster":
      return <RosterWidget widget={widget} />;
    case "calendar":
      return <CalendarWidget widget={widget} />;
    default:
      return (
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs text-muted-foreground font-mono">{widget.kind}</p>
        </div>
      );
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

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
                        <WidgetCard key={w.id} widget={w} />
                      ))}
                    </div>
                  )}
                  {others.map((w) => (
                    <WidgetCard key={w.id} widget={w} />
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
