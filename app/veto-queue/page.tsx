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
import {
  orderDecisionQueue,
  buildDecisionView,
  type DecisionInput,
} from "@/lib/blockers/decision-view";
import { DecisionFocus } from "@/components/decisions/decision-focus";
import {
  resolveVetoAction,
  resolveWithInputAction,
  confirmBlockerAction,
  dismissVetoAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function VetoQueuePage(): Promise<React.ReactElement> {
  const rt = await buildChatRuntime();
  if (isAnonymous(rt.actor)) redirect("/signin");
  if (rt.actor?.role !== "steward") redirect("/");

  const open = await getAllOpenBlockers(rt.ctx);
  // ALL blockers (incl. resolved) feed the learning trace ("community usually
  // picks X"); the open ones are the queue, ordered oldest-first.
  const allRows = (await (
    rt.ctx.objects as unknown as { AgentBlocker: { findMany(q?: unknown): Promise<unknown[]> } }
  ).AgentBlocker.findMany()) as DecisionInput[];
  const views = orderDecisionQueue(open as unknown as DecisionInput[]).map((b) =>
    buildDecisionView(b, allRows),
  );

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
              {views.length} open
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
              <span className="font-semibold text-success">{autoApplied}</span> routine{" "}
              {autoApplied === 1 ? "action" : "actions"} auto-applied{" "}
              <span className="text-muted-foreground">·</span>{" "}
              <span className="font-semibold text-warning">{escalated}</span> escalated to you
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No agent decisions recorded yet.</p>
          )}
        </div>

        <DecisionFocus
          key={views.length}
          decisions={views}
          resolveAction={resolveVetoAction}
          resolveInputAction={resolveWithInputAction}
          confirmAction={confirmBlockerAction}
          dismissAction={dismissVetoAction}
        />
      </div>
    </main>
  );
}
