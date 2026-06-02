// ResolvedWidgetCard — shared renderer for V2 catalog widgets (ResolvedWidget).
//
// Extracted from app/page.tsx so both the per-user home dashboard and the
// steward org dashboard can import the same render path without duplication.
//
// This is NOT a new rendering path: it IS the rendering path previously
// defined in app/page.tsx, promoted to a shared component. app/page.tsx
// imports from here; app/org/page.tsx imports from here. One path, two callers.
//
// Cards are NAVIGABLE: the board is the navigation (no fixed nav tabs). A card's
// title links to its full collection at /[type]; a plain data_table's rows link
// to the detail at /[type]/[id]. The link uses config.type (the snake token);
// the /[type] route resolves either the token or the PascalCase key.

import Link from "next/link";
import type { ResolvedWidget } from "@/lib/widgets/compose";
import type {
  MetricData,
  DataTableData,
  RosterData,
  CalendarData,
} from "@/lib/widgets/catalog";
import { prettify } from "@/lib/prettify";
import {
  invokeRowActionForm,
  invokeRowResolverForm,
  invokeRowConfirmForm,
} from "@/lib/widgets/row-action.server";
import { parseConfirmAction } from "@/lib/widgets/row-confirm";

// ── CardTitle ─────────────────────────────────────────────────────────────────
// A card's title. When the widget is bound to an ontology type, the title links
// to that type's full collection view (/[type]) — this is how the board doubles
// as the navigation. Untyped widgets render a plain label.
function CardTitle({
  type,
  label,
  className,
}: {
  type?: string;
  label: string;
  className: string;
}) {
  if (type) {
    return (
      <Link
        href={`/${type}`}
        className={`${className} inline-flex items-center gap-1 hover:text-foreground transition-colors`}
      >
        {label}
        <span aria-hidden className="opacity-40">
          →
        </span>
      </Link>
    );
  }
  return <p className={className}>{label}</p>;
}

const TITLE_CLS = "text-xs uppercase tracking-widest text-muted-foreground";

// ── MetricWidget ──────────────────────────────────────────────────────────────

// Renders the generic `metric` (COUNT(*) over any ontology type). Produces MetricData;
// carries a {type, agg, filter} config (so it can derive a label + show the agg footer).
function MetricWidget({ widget }: { widget: ResolvedWidget }) {
  const data = widget.data as MetricData;
  const config = widget.config as {
    type?: string;
    agg?: string;
    filter?: { field: string; value: string };
  };
  const label =
    widget.title ??
    (config.type
      ? config.filter
        ? `${prettify(config.type)} (${config.filter.field}=${config.filter.value})`
        : prettify(config.type)
      : data.label);

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <CardTitle type={config.type} label={label} className={`${TITLE_CLS} mb-2`} />
      <p className="text-4xl font-bold tabular-nums text-foreground">
        {data.display ?? data.value}
      </p>
      {config.agg ? (
        <p className="text-xs text-muted-foreground mt-1">{config.agg}</p>
      ) : null}
    </div>
  );
}

// ── DataTableWidget ───────────────────────────────────────────────────────────

function DataTableWidget({ widget }: { widget: ResolvedWidget }) {
  const data = widget.data as DataTableData;
  const config = widget.config as { type: string; columns: string[]; limit?: number };
  const label = widget.title ?? prettify(config.type);

  // DERIVED row actions (e.g. Dismiss Blocker) attached at resolve time from
  // the ontology — undefined/empty for generic tables (rendered unchanged).
  const rowActions = widget.rowActions ?? [];
  // DERIVED per-row CHOICE pickers (e.g. resolve_blocker_with_pathway): the
  // resolver DEFINITIONS for this type; the choices come from each row's
  // choicesFrom column at render time.
  const rowResolvers = widget.rowResolvers ?? [];
  // DERIVED per-row BINARY CONFIRMs (e.g. resolve_blocker_with_custom): the
  // confirm DEFINITIONS for this type; the label + action come from each row's
  // `source` column at render time (invocation derived server-side).
  const rowConfirms = widget.rowConfirms ?? [];
  const hasRowActions =
    rowActions.length > 0 || rowResolvers.length > 0 || rowConfirms.length > 0;

  // "id" is the action target, not a display column. The resolvers' choicesFrom
  // columns (e.g. "pathways") and the confirms' source columns (e.g.
  // "confirm_action") carry raw JSON consumed for buttons, not display. All are
  // hidden from the visible columns when affordances are present; row["id"]
  // remains the React key + action objectId. (When no affordances, id is shown
  // as a normal column.)
  const hiddenColumns = new Set<string>(["id"]);
  for (const r of rowResolvers) hiddenColumns.add(r.choicesFrom);
  for (const c of rowConfirms) hiddenColumns.add(c.source);
  const visibleColumns = hasRowActions
    ? data.columns.filter((c) => !hiddenColumns.has(c))
    : data.columns;

  if (data.rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <CardTitle type={config.type} label={label} className={`${TITLE_CLS} mb-2`} />
        <p className="text-xs text-muted-foreground">No rows.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <CardTitle type={config.type} label={label} className={`${TITLE_CLS} mb-3`} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground text-left">
              {visibleColumns.map((col) => (
                <th key={col} className="font-normal pb-2 pr-4">
                  {col}
                </th>
              ))}
              {hasRowActions ? (
                <th className="font-normal pb-2 pr-4">Actions</th>
              ) : (
                <th className="font-normal pb-2" aria-hidden></th>
              )}
            </tr>
          </thead>
          <tbody className="text-foreground">
            {data.rows.map((row, i) => {
              const rowId = String(row["id"] ?? i);
              return (
                <tr
                  key={hasRowActions ? rowId : i}
                  className={i > 0 ? "border-t border-border/60" : ""}
                >
                  {visibleColumns.map((col) => (
                    <td key={col} className="py-1 pr-4 align-top">
                      {row[col] != null ? String(row[col]) : "—"}
                    </td>
                  ))}
                  {hasRowActions ? (
                    <td className="py-1 pr-4 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {rowActions.map(({ action }) => (
                          <form
                            key={action}
                            action={invokeRowActionForm.bind(null, action, rowId)}
                          >
                            <button
                              type="submit"
                              className="text-xs rounded border border-border px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                            >
                              {prettify(action)}
                            </button>
                          </form>
                        ))}
                        {rowResolvers.map((resolver) => {
                          // Each row's choicesFrom column holds a JSON array of
                          // {id,label}. Parse defensively — skip on invalid/empty.
                          const raw = row[resolver.choicesFrom];
                          let choices: Array<{ id: string; label: string }> = [];
                          if (typeof raw === "string") {
                            try {
                              const parsed = JSON.parse(raw) as unknown;
                              if (Array.isArray(parsed)) {
                                choices = parsed.filter(
                                  (c): c is { id: string; label: string } =>
                                    c != null &&
                                    typeof c === "object" &&
                                    typeof (c as { id?: unknown }).id === "string" &&
                                    typeof (c as { label?: unknown }).label === "string",
                                );
                              }
                            } catch {
                              // corrupt JSON — render no choices for this resolver
                            }
                          }
                          return choices.map((choice) => (
                            <form
                              key={`${resolver.action}:${choice.id}`}
                              action={invokeRowResolverForm.bind(
                                null,
                                resolver.action,
                                rowId,
                                choice.id,
                              )}
                            >
                              <button
                                type="submit"
                                className="text-xs rounded border border-border px-2 py-1 text-foreground hover:bg-muted"
                              >
                                {choice.label}
                              </button>
                            </form>
                          ));
                        })}
                        {rowConfirms.map((confirm) => {
                          // Each row's `source` column holds a JSON
                          // {label, action} proposal. Parse fail-closed — skip
                          // when absent/corrupt. The invocation is derived
                          // SERVER-SIDE from this same column; the form supplies
                          // only the action name + row id (no injection surface).
                          const parsed = parseConfirmAction(row[confirm.source]);
                          if (!parsed) return null;
                          return (
                            <form
                              key={`${confirm.action}:confirm`}
                              action={invokeRowConfirmForm.bind(
                                null,
                                confirm.action,
                                rowId,
                              )}
                            >
                              <button
                                type="submit"
                                className="text-xs rounded border border-foreground px-2 py-1 font-medium text-foreground hover:bg-foreground hover:text-background"
                              >
                                {`Confirm: ${parsed.label}`}
                              </button>
                            </form>
                          );
                        })}
                      </div>
                    </td>
                  ) : (
                    <td className="py-1 align-top text-right">
                      <Link
                        href={`/${config.type}/${rowId}`}
                        className="text-primary hover:text-primary/80 whitespace-nowrap"
                      >
                        open →
                      </Link>
                    </td>
                  )}
                </tr>
              );
            })}
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
        <CardTitle type={config.type} label={label} className={`${TITLE_CLS} mb-2`} />
        <p className="text-xs text-muted-foreground">No entries.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <CardTitle type={config.type} label={label} className={`${TITLE_CLS} mb-3`} />
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
        <CardTitle type={config.type} label={emptyLabel} className={`${TITLE_CLS} mb-2`} />
        <p className="text-xs text-muted-foreground">No events.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <CardTitle type={config.type} label={populatedLabel} className={`${TITLE_CLS} mb-3`} />
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

// ── WidgetErrorCard ───────────────────────────────────────────────────────────
//
// Rendered when a widget's stored config no longer validates against the current
// ontology (structural drift — a type renamed/removed, a field deleted). The
// resolve path returns the widget with data:null + validation_error instead of
// silently dropping it, so the steward SEES the broken view and can act on it
// (governance over silent mutation). Tokens only — no hardcoded palette.
function WidgetErrorCard({ widget }: { widget: ResolvedWidget }) {
  const ve = widget.validation_error;
  const label = widget.title ?? prettify(widget.kind);
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-2">
        <span aria-hidden className="text-muted-foreground">
          ⚠
        </span>
        <p className={TITLE_CLS}>{label}</p>
      </div>
      <p className="text-xs text-foreground mb-1">This widget no longer matches the ontology.</p>
      <p className="text-xs text-muted-foreground">
        {ve?.error ?? "Its saved configuration is no longer valid."}
      </p>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mt-3 font-mono">
        {widget.kind}
        {ve?.kind ? ` · ${ve.kind}` : ""}
      </p>
    </div>
  );
}

// ── ResolvedWidgetCard (dispatcher) ──────────────────────────────────────────

export function ResolvedWidgetCard({ widget }: { widget: ResolvedWidget }) {
  // Drift guard: a widget carrying a validation_error has data:null — render the
  // error card instead of dispatching to a kind renderer (which would crash on
  // the null data). This is the visible signal of structural drift.
  if (widget.validation_error) {
    return <WidgetErrorCard widget={widget} />;
  }
  switch (widget.kind) {
    case "metric":
      return <MetricWidget widget={widget} />;
    case "intelligence_metric":
      // Same MetricData shape as `metric`; its config carries no ontology `type`,
      // so MetricWidget renders data.label ("Agent autonomy") + data.display ("69%").
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
