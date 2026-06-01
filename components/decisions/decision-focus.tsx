// The Focus decision surface (client): presents ONE decision at a time — the
// most urgent (oldest) — as a weighty card. Disposing it (pick a path / resolve
// / dismiss) revalidates the queue server-side; the list shrinks and this
// component remounts (keyed on length by the page) to surface the next. "skip →"
// peeks ahead without disposing. Embodies the opinion: a decision is a deliberate
// act, not a list item. Reuses the existing audited server actions.
"use client";

import { useState } from "react";
import type { DecisionView, ReversibilityTier } from "@/lib/blockers/decision-view";

type ResolveAction = (blockerId: string, pathwayId?: string) => Promise<void>;
type DismissAction = (blockerId: string, reason?: string) => Promise<void>;

const REV_LABEL: Record<ReversibilityTier, string> = {
  easy: "reversible",
  moderate: "reversible · some effort",
  permanent: "irreversible",
};
const REV_CLS: Record<ReversibilityTier, string> = {
  easy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  moderate: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  permanent: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

function AllClear(): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-card/20 p-10 text-center">
      <p className="text-sm text-foreground">Nothing awaiting your decision.</p>
      <p className="mt-2 text-xs text-muted-foreground/70">
        The agent auto-applies routine actions; judgment calls land here, one at a time.
      </p>
    </div>
  );
}

export function DecisionFocus({
  decisions,
  resolveAction,
  dismissAction,
}: {
  decisions: DecisionView[];
  resolveAction: ResolveAction;
  dismissAction: DismissAction;
}): React.ReactElement {
  const [cursor, setCursor] = useState(0);

  if (decisions.length === 0) return <AllClear />;

  const idx = ((cursor % decisions.length) + decisions.length) % decisions.length;
  const d = decisions[idx];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Decision <span className="font-medium text-foreground">{idx + 1}</span> of {decisions.length}
          <span className="text-muted-foreground/60"> · most urgent first</span>
        </span>
        {decisions.length > 1 && (
          <button onClick={() => setCursor(idx + 1)} className="hover:text-foreground">
            skip →
          </button>
        )}
      </div>

      <article className="space-y-4 rounded-xl border border-border bg-card/40 p-5">
        {/* Framing */}
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
              {d.reasonKind}
            </span>
            {d.blockedActorId && (
              <span className="font-mono text-[10px] text-muted-foreground/70">
                for {d.blockedActorId.slice(0, 8)}
              </span>
            )}
          </div>
          <h2 className="mt-2 text-lg font-semibold leading-snug text-foreground">{d.summary}</h2>
          {d.detail && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d.detail}</p>}
        </div>

        {/* Disposition */}
        {d.scenarios.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Choose a path</p>
            {d.scenarios.map((s) => (
              <form key={s.id} action={resolveAction.bind(null, d.id, s.id)}>
                <button
                  type="submit"
                  className="w-full rounded-lg border border-border bg-card/60 px-4 py-3 text-left transition-colors hover:border-foreground/40 hover:bg-card"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">{s.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {s.recommended && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
                          recommended
                        </span>
                      )}
                      <span className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${REV_CLS[s.reversibility]}`}>
                        {REV_LABEL[s.reversibility]}
                      </span>
                    </span>
                  </div>
                  {s.consequence && <p className="mt-1 text-xs text-muted-foreground">{s.consequence}</p>}
                </button>
              </form>
            ))}
          </div>
        ) : (
          <form action={resolveAction.bind(null, d.id, undefined)}>
            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-emerald-50 hover:bg-emerald-600"
            >
              Resolve
            </button>
          </form>
        )}

        {/* Learning trace (transparency — never reorders the scenarios) */}
        {d.trace && (
          <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <span className="text-muted-foreground/70">learned:</span> the community usually picks{" "}
            <span className="font-medium text-foreground">{d.trace.label}</span> ({d.trace.count}/{d.trace.total})
          </p>
        )}

        <form action={dismissAction.bind(null, d.id, undefined)} className="pt-1">
          <button type="submit" className="text-xs text-muted-foreground hover:text-foreground">
            Dismiss — no action needed
          </button>
        </form>
      </article>
    </div>
  );
}
