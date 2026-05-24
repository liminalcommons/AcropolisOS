// M4.3: /me — the agent's escalation queue for the current user.
//
// Server component. Auth-required (redirects anon to /signin — mirrors
// /inbox M3.8 #37 pattern). Queries open AgentBlocker rows + MemberContext
// for the session user. Renders the widget bundle: agent_blockers first
// (most prominent), then needed_actions, available_actions, recent_context,
// inbox_unread, then any pinned widgets.

import Link from "next/link";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getAgentBlockers } from "@/lib/me/fetchers/agent-blockers";
import { getOrCreateMemberContext } from "@/lib/me/fetchers/member-context";
import { PinnedWidget, type PinnedWidgetShape } from "@/components/dashboard/PinnedWidget";
import {
  resolveBlockerAction,
  dismissBlockerAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

const REASON_LABELS: Record<string, string> = {
  approval: "Approval",
  confirmation: "Confirmation",
  ambiguity: "Ambiguity",
  missing_data: "Missing data",
  consent: "Consent",
  decision: "Decision",
  risky_action: "Risky action",
};

const REASON_COLORS: Record<string, string> = {
  approval: "bg-amber-900/40 text-amber-300",
  confirmation: "bg-blue-900/40 text-blue-300",
  ambiguity: "bg-purple-900/40 text-purple-300",
  missing_data: "bg-red-900/40 text-red-300",
  consent: "bg-orange-900/40 text-orange-300",
  decision: "bg-violet-900/40 text-violet-300",
  risky_action: "bg-rose-900/40 text-rose-300",
};

export default async function MePage(): Promise<React.ReactElement> {
  // Middleware enforces auth; no redirect needed here — middleware intercepts before page renders.
  const chatRuntime = await buildChatRuntime();
  // M3.8 (#37): isAnonymous guard kept as type-narrowing; middleware already blocked anon callers.
  if (isAnonymous(chatRuntime.actor)) {
    // unreachable: middleware redirects to /signin before this executes
    return <></>;
  }
  const actor = chatRuntime.actor!;
  const ctx = chatRuntime.ctx;

  // Resolve Member row for the session user
  const members = await ctx.objects.Member.findMany();
  const me = members.find((m) => m.id === actor.userId || m.user_id === actor.userId);
  if (!me) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-sm text-zinc-500">
          No Member row found for your account. Contact a steward.
        </p>
      </main>
    );
  }

  // Get/create MemberContext
  const mc = await getOrCreateMemberContext(ctx, me.id);

  // Fetch agent blockers
  const blockersBundle = await getAgentBlockers(ctx, me.id);
  const blockers = blockersBundle.data.blockers;

  // Parse pinned widgets — DB returns text (JSON string) or legacy array.
  let pinnedWidgets: PinnedWidgetShape[] = [];
  const rawPinned = mc.pinned_widgets;
  if (Array.isArray(rawPinned)) {
    pinnedWidgets = rawPinned as PinnedWidgetShape[];
  } else if (typeof rawPinned === "string") {
    try {
      const parsed = JSON.parse(rawPinned);
      if (Array.isArray(parsed)) pinnedWidgets = parsed as PinnedWidgetShape[];
    } catch {
      // treat as empty
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-8 py-10 space-y-6">
        <div className="flex items-baseline gap-3">
          <Link href="/ontology-editor" className="text-xs text-zinc-500 hover:text-zinc-300">
            ← ontology editor
          </Link>
          <span className="text-xs text-zinc-600">/</span>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">
            /me
          </h1>
          <span className="text-xs text-zinc-500">
            agent escalation queue for {me.full_name}
          </span>
        </div>

        {/* HEADLINE: agent_blockers — full-width, most prominent */}
        <section
          data-testid="widget-agent_blockers"
          className={
            blockers.length > 0
              ? "rounded-lg border border-amber-800/60 bg-amber-950/20 p-5"
              : "rounded-lg border border-zinc-800 bg-zinc-900/30 p-5"
          }
        >
          <div className="flex items-center gap-2 mb-4">
            <span
              className={`text-xs font-bold uppercase tracking-widest ${
                blockers.length > 0 ? "text-amber-400" : "text-zinc-500"
              }`}
            >
              Agent blockers
            </span>
            {blockers.length > 0 && (
              <span className="rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-zinc-950">
                {blockers.length}
              </span>
            )}
          </div>

          {blockers.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No open blockers. The agent is running autonomously.
            </p>
          ) : (
            <ul className="space-y-4">
              {blockers.map((b) => (
                <li
                  key={b.id}
                  id={`blocker-${b.id}`}
                  className="rounded-md border border-zinc-700 bg-zinc-900/60 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`pill text-[10px] px-2 py-0.5 rounded font-mono ${
                            REASON_COLORS[b.reason_kind] ?? "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {REASON_LABELS[b.reason_kind] ?? b.reason_kind}
                        </span>
                        <span className="font-medium text-sm text-zinc-100">
                          {b.summary}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                        {b.detail}
                      </p>
                      {b.blocked_work_ref && (
                        <p className="mt-1 text-[10px] font-mono text-zinc-600">
                          ref: {b.blocked_work_ref}
                        </p>
                      )}
                      <time className="mt-1 block text-[10px] text-zinc-600">
                        {fmtTime(b.created_at)}
                      </time>
                    </div>
                    <div className="shrink-0 flex flex-col gap-2">
                      <form action={resolveBlockerAction.bind(null, b.id)}>
                        <button
                          type="submit"
                          data-testid={`resolve-blocker-${b.id}`}
                          className="rounded-md bg-emerald-700 px-3 py-1.5 text-[11px] font-medium text-zinc-50 hover:bg-emerald-600 w-full"
                        >
                          Resolve
                        </button>
                      </form>
                      <form action={dismissBlockerAction.bind(null, b.id, undefined)}>
                        <button
                          type="submit"
                          data-testid={`dismiss-blocker-${b.id}`}
                          className="rounded-md bg-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-400 hover:bg-zinc-700 w-full"
                        >
                          Dismiss
                        </button>
                      </form>
                    </div>
                  </div>
                  {b.pathways && Array.isArray(b.pathways) && b.pathways.length > 0 && (
                    <div className="mt-3 rounded bg-zinc-800/60 px-3 py-2">
                      <p className="text-[10px] font-mono text-zinc-500 mb-2">Suggested paths:</p>
                      <ul className="space-y-1">
                        {(b.pathways as Array<{ id: string; label: string; rationale: string; reversibility: string }>).map((p) => (
                          <li key={p.id} className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${p.reversibility === "permanent" ? "bg-red-500" : p.reversibility === "moderate" ? "bg-amber-500" : "bg-emerald-500"}`} title={p.reversibility} />
                            <form action={resolveBlockerAction.bind(null, b.id, p.id)} className="inline">
                              <button type="submit" className="text-[10px] text-zinc-300 hover:text-zinc-100 text-left">
                                {p.label} — <span className="text-zinc-500">{p.rationale}</span>
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Pinned widgets */}
        {pinnedWidgets.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">
              Pinned widgets
            </h2>
            <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {pinnedWidgets.map((w) => (
                <li key={w.id}>
                  <PinnedWidget widget={w} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Footer note */}
        <p className="text-xs text-zinc-600 pt-4 border-t border-zinc-800">
          /me is your agent&apos;s escalation queue. The agent flags blockers here when
          it needs your input to continue work. Resolve or dismiss each one.
        </p>

        {/* Pin widgets via /dashboard/ask — agent-driven pinning (F6) */}
        <p className="text-xs text-zinc-600 border border-zinc-800 rounded-lg p-4">
          To pin a widget, use{" "}
          <Link href="/dashboard/ask" className="text-zinc-400 hover:text-zinc-200 underline">
            Ask the agent
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
