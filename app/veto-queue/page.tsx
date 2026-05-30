// Steward veto-queue (storyboard Scene 6, "Awaiting your decision"). The home
// board shows open blockers as a read-only table; THIS page lets a steward ACT
// on EVERY open blocker org-wide (resolve / dismiss / pick a pathway) and shows
// the autonomy split ("N auto-applied · M escalated") — the autonomy you can
// see and veto. Steward-only.
import Link from "next/link";
import { redirect } from "next/navigation";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { PgAuditReader } from "@/lib/audit/reader";
import { getAllOpenBlockers } from "@/lib/me/fetchers/all-blockers";
import {
  autonomyCounts,
  type MetricAuditRow,
  type PolicyOf,
} from "@/lib/metrics/community-intelligence";
import { resolveVetoAction, dismissVetoAction } from "./actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtTime(iso: string): string {
  // Stable, locale-independent (avoid hydration drift): YYYY-MM-DD HH:MM.
  return iso.replace("T", " ").slice(0, 16);
}

export default async function VetoQueuePage(): Promise<React.ReactElement> {
  const rt = await buildChatRuntime();
  if (isAnonymous(rt.actor)) redirect("/signin");
  if (rt.actor?.role !== "steward") redirect("/");

  const blockers = await getAllOpenBlockers(rt.ctx);

  // Autonomy split — derive policyOf from the live ontology (not a stale map).
  const auditRows = await new PgAuditReader(getDb()).listAction({ limit: 1000 });
  const audits: MetricAuditRow[] = auditRows.map((r) => ({
    subject_type: r.subject_type,
    subject_id: r.subject_id,
    metadata: r.metadata as { result?: string },
  }));
  const policyOf: PolicyOf = (name) => rt.ontology.action_types[name]?.agent_policy;
  const { autoApplied, escalated } = autonomyCounts(audits, policyOf);
  const hasSplit = autoApplied + escalated > 0;

  return (
    <main className="min-h-full font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
        <div>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← dashboard
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            Awaiting your decision{" "}
            <span className="text-muted-foreground font-normal">·</span>{" "}
            <span className="text-muted-foreground font-normal text-base">
              {blockers.length} open
            </span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Every judgment call the agent escalated, org-wide. Resolve, dismiss, or pick a pathway.
          </p>
        </div>

        {/* Autonomy split — the autonomy you can see */}
        <div className="rounded-lg border border-border bg-card/30 px-4 py-3">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Agent autonomy</p>
          {hasSplit ? (
            <p className="mt-1 text-sm text-foreground">
              <span className="font-semibold text-emerald-400">{autoApplied}</span> routine{" "}
              {autoApplied === 1 ? "action" : "actions"} auto-applied{" "}
              <span className="text-muted-foreground">·</span>{" "}
              <span className="font-semibold text-amber-300">{escalated}</span> escalated to you
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No agent decisions recorded yet.</p>
          )}
        </div>

        {blockers.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">Nothing awaiting your decision.</p>
            <p className="text-xs text-muted-foreground/60 mt-2">
              The agent auto-applies routine actions; judgment calls land here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {blockers.map((b) => (
              <li key={b.id} className="rounded-lg border border-border bg-card/30 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
                        {b.reason_kind}
                      </span>
                      <span className="text-sm font-medium text-foreground">{b.summary}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{b.detail}</p>
                    {b.blocked_work_ref && (
                      <p className="mt-1 text-[10px] font-mono text-muted-foreground">ref: {b.blocked_work_ref}</p>
                    )}
                    {b.blocked_actor_id && (
                      <p className="mt-1 text-[10px] font-mono text-muted-foreground/70">
                        for: {b.blocked_actor_id.slice(0, 8)}
                      </p>
                    )}
                    <time className="mt-1 block text-[10px] text-muted-foreground">{fmtTime(b.created_at)}</time>
                  </div>
                  <div className="shrink-0 flex flex-col gap-2">
                    <form action={resolveVetoAction.bind(null, b.id)}>
                      <button
                        type="submit"
                        className="w-full rounded-md bg-emerald-700 px-3 py-1.5 text-[11px] font-medium text-emerald-50 hover:bg-emerald-600"
                      >
                        Resolve
                      </button>
                    </form>
                    <form action={dismissVetoAction.bind(null, b.id, undefined)}>
                      <button
                        type="submit"
                        className="w-full rounded-md bg-secondary px-3 py-1.5 text-[11px] font-medium text-secondary-foreground hover:bg-secondary/80"
                      >
                        Dismiss
                      </button>
                    </form>
                  </div>
                </div>
                {b.pathways && Array.isArray(b.pathways) && b.pathways.length > 0 && (
                  <div className="mt-3 rounded bg-card/60 px-3 py-2">
                    <p className="mb-2 text-[10px] font-mono text-muted-foreground">Suggested paths:</p>
                    <ul className="space-y-1">
                      {b.pathways.map((p) => (
                        <li key={p.id} className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              p.reversibility === "permanent"
                                ? "bg-red-500"
                                : p.reversibility === "moderate"
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                            }`}
                            title={p.reversibility}
                          />
                          <form action={resolveVetoAction.bind(null, b.id, p.id)} className="inline">
                            <button type="submit" className="text-left text-[10px] text-foreground hover:text-muted-foreground">
                              {p.label} — <span className="text-muted-foreground">{p.rationale}</span>
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
      </div>
    </main>
  );
}
