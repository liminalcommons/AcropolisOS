// The Focus decision surface (client): presents ONE decision at a time — the
// most urgent (oldest) — as a weighty card. Disposing it (pick a path / submit
// an answer / confirm / dismiss) revalidates the queue server-side; the list
// shrinks and this component remounts (keyed on length by the page) to surface
// the next. "skip →" peeks ahead without disposing. Embodies the opinion: a
// decision is a deliberate act, not a list item. Reuses the existing audited
// server actions.
//
// LAYOUT: every option reads top-to-bottom (vertical, mobile-first). For
// pathways, each path is a full-width block with a colored LEFT RAIL encoding
// reversibility — because the queue is safest-first, the column becomes a
// green→red safety gradient (the opinion made spatial). No side-by-side rows.
"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { buildDiscussPrompt, type DecisionView, type ReversibilityTier } from "@/lib/blockers/decision-view";
import { storePendingDiscussPrompt } from "@/lib/decisions/discuss-prompt-state";

type ResolveAction = (blockerId: string, pathwayId?: string) => Promise<void>;
type DismissAction = (blockerId: string, reason?: string) => Promise<void>;
type FormAction = (blockerId: string, form: FormData) => Promise<void>;

const REV_LABEL: Record<ReversibilityTier, string> = {
  easy: "reversible",
  moderate: "reversible · some effort",
  permanent: "irreversible",
};
const REV_GLYPH: Record<ReversibilityTier, string> = { easy: "✓", moderate: "~", permanent: "✕" };
// Left rail + tier text: the safety gradient (emerald → amber → rose).
const RAIL_CLS: Record<ReversibilityTier, string> = {
  easy: "border-l-emerald-500",
  moderate: "border-l-amber-500",
  permanent: "border-l-rose-500",
};
const TIER_TEXT: Record<ReversibilityTier, string> = {
  easy: "text-success",
  moderate: "text-warning",
  permanent: "text-destructive",
};

// "Discuss with the agent" (the 4th affordance): doesn't dispose the decision —
// it opens the co-pilot chat scoped to THIS decision so the human can ask "why
// these options?" / "what if X?" before picking. Reuses the existing
// acropolisos:prompt seam (fills + focuses the composer); a fresh
// acropolisos:open-chat first expands the dock, since ChatPanel is unmounted —
// and so deaf to acropolisos:prompt — while the dock is collapsed.
function discussDecision(d: DecisionView): void {
  if (typeof window === "undefined") return;
  const prompt = buildDiscussPrompt(d);
  window.dispatchEvent(new CustomEvent("acropolisos:open-chat"));
  // Park the prompt in sessionStorage BEFORE firing the in-memory event. If the
  // dock was collapsed (ChatPanel unmounted) the events miss, but ChatPanel
  // reads this on its next mount/hydration — the prompt survives the race.
  storePendingDiscussPrompt(prompt);
  const fire = (): void => {
    window.dispatchEvent(new CustomEvent("acropolisos:prompt", { detail: { prompt } }));
  };
  fire(); // dock already open (the common case) catches it immediately
  // …and again once a collapsed dock has un-collapsed + ChatPanel re-mounted its
  // listener. setInput(prompt) is idempotent, so the double-fire is harmless.
  setTimeout(fire, 120);
}

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
  resolveInputAction,
  confirmAction,
  dismissAction,
}: {
  decisions: DecisionView[];
  resolveAction: ResolveAction;
  resolveInputAction: FormAction;
  confirmAction: FormAction;
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
            <span className="rounded bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warning">
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

        {/* Disposition — shape depends on the agent's chosen resolution mode */}
        {d.mode === "pathways" && d.scenarios.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Choose a path</p>
            {d.scenarios.map((s) => (
              <form key={s.id} action={resolveAction.bind(null, d.id, s.id)}>
                <button
                  type="submit"
                  className={`block w-full rounded-r-lg border-l-4 bg-card/40 py-3 pl-4 pr-4 text-left transition-colors hover:bg-card ${RAIL_CLS[s.reversibility]}`}
                >
                  {s.recommended && (
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-success">
                      ● recommended
                    </p>
                  )}
                  <p className="text-[15px] font-semibold leading-snug text-foreground">{s.label}</p>
                  {s.consequence && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.consequence}</p>
                  )}
                  <p className={`mt-1.5 text-[11px] font-medium ${TIER_TEXT[s.reversibility]}`}>
                    {REV_GLYPH[s.reversibility]} {REV_LABEL[s.reversibility]}
                  </p>
                </button>
              </form>
            ))}
          </div>
        ) : d.mode === "text_input" ? (
          <form action={resolveInputAction.bind(null, d.id)} className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {d.inputPrompt ?? "Your answer"}
            </p>
            <textarea
              name="answer"
              required
              rows={3}
              placeholder="Type your answer…"
              className="w-full rounded-lg border border-border bg-card/60 px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-emerald-50 hover:bg-emerald-600"
            >
              Submit answer
            </button>
          </form>
        ) : d.mode === "confirm_binary" && d.confirm ? (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Confirm or decline</p>
            <form action={confirmAction.bind(null, d.id)}>
              <button
                type="submit"
                className="block w-full rounded-r-lg border-l-4 border-l-emerald-500 bg-emerald-700/20 py-3 pl-4 pr-4 text-left transition-colors hover:bg-emerald-700/30"
              >
                <span className="text-[15px] font-semibold text-foreground">{d.confirm.label}</span>
                <span className={`mt-1 block text-[11px] font-medium ${TIER_TEXT[d.confirm.reversibility]}`}>
                  {REV_GLYPH[d.confirm.reversibility]} {REV_LABEL[d.confirm.reversibility]}
                </span>
              </button>
            </form>
            <form action={dismissAction.bind(null, d.id, "declined")}>
              <button
                type="submit"
                className="block w-full rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-card/40 hover:text-foreground"
              >
                Decline
              </button>
            </form>
          </div>
        ) : (
          // Fallback: pathways mode with no curated paths, or a confirm_binary
          // whose proposal failed to parse — a generic resolve still clears it.
          <form action={resolveAction.bind(null, d.id, undefined)}>
            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-emerald-50 hover:bg-emerald-600"
            >
              Resolve
            </button>
          </form>
        )}

        {/* Discuss (4th affordance): talk it through before disposing */}
        <button
          type="button"
          onClick={() => discussDecision(d)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card/30 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          Discuss with the agent
        </button>

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
