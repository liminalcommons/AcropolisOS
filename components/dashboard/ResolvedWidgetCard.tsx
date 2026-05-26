// ResolvedWidgetCard — shared renderer for V2 catalog widgets (ResolvedWidget).
//
// Extracted from app/page.tsx so both the per-user home dashboard and the
// steward org dashboard can import the same render path without duplication.
//
// This is NOT a new rendering path: it IS the rendering path previously
// defined in app/page.tsx, promoted to a shared component. app/page.tsx
// imports from here; app/org/page.tsx imports from here. One path, two callers.

import type { ResolvedWidget } from "@/lib/widgets/compose";
import type {
  MetricData,
  DataTableData,
  RosterData,
  CalendarData,
} from "@/lib/widgets/catalog";
import { prettify } from "@/lib/prettify";

// ── MetricWidget ──────────────────────────────────────────────────────────────

function MetricWidget({ widget }: { widget: ResolvedWidget }) {
  const data = widget.data as MetricData;
  const config = widget.config as { type: string; agg: string; filter?: { field: string; value: string } };
  const label = widget.title ?? (config.filter
    ? `${prettify(config.type)} (${config.filter.field}=${config.filter.value})`
    : prettify(config.type));

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

// ── DataTableWidget ───────────────────────────────────────────────────────────

function DataTableWidget({ widget }: { widget: ResolvedWidget }) {
  const data = widget.data as DataTableData;
  const config = widget.config as { type: string; columns: string[]; limit?: number };
  const label = widget.title ?? prettify(config.type);

  if (data.rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          {label}
        </p>
        <p className="text-xs text-muted-foreground">No rows.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
        {label}
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

// ── RosterWidget ──────────────────────────────────────────────────────────────

function RosterWidget({ widget }: { widget: ResolvedWidget }) {
  const data = widget.data as RosterData;
  const config = widget.config as { type: string; fields: string[]; limit?: number };
  const label = widget.title ?? `${prettify(config.type)} roster`;

  if (data.entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          {label}
        </p>
        <p className="text-xs text-muted-foreground">No entries.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
        {label}
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

// ── CalendarWidget ────────────────────────────────────────────────────────────

function CalendarWidget({ widget }: { widget: ResolvedWidget }) {
  const data = widget.data as CalendarData;
  const config = widget.config as { type: string; date_field: string };

  const bucketKeys = Object.keys(data.buckets).sort();
  const emptyLabel = widget.title ?? `${prettify(config.type)} calendar`;
  const populatedLabel = widget.title ?? `${prettify(config.type)} calendar (${config.date_field})`;

  if (bucketKeys.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          {emptyLabel}
        </p>
        <p className="text-xs text-muted-foreground">No events.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
        {populatedLabel}
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

// ── ResolvedWidgetCard (dispatcher) ──────────────────────────────────────────

export function ResolvedWidgetCard({ widget }: { widget: ResolvedWidget }) {
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
