// Org-wide open agent_blockers, for the steward veto-queue. The per-recipient
// fetcher (getAgentBlockers) narrows to one member; this returns EVERY open
// blocker. A STEWARD ctx returns all rows (the steward read token matches every
// row); a non-steward ctx is narrowed by the fence (member_self) — fail-safe,
// but the caller MUST steward-gate the surface so a member never sees a
// misleadingly-partial "org-wide" queue.
import type { OntologyCtx } from "@/lib/ontology/ctx";
import type {
  ReasonKind,
  ResolutionMode,
  BlockerPathway,
} from "../widgets";

export interface OpenBlocker {
  id: string;
  blocked_actor_id: string | null;
  reason_kind: ReasonKind;
  summary: string;
  detail: string;
  blocked_work_ref: string | null;
  resolution_mode: ResolutionMode;
  pathways: BlockerPathway[] | null;
  created_at: string;
}

export async function getAllOpenBlockers(ctx: OntologyCtx): Promise<OpenBlocker[]> {
  const all = await ctx.objects.AgentBlocker.findMany();
  return all
    .filter((b) => b.status === "open")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((b) => ({
      id: b.id,
      blocked_actor_id: b.blocked_actor_id ?? null,
      reason_kind: b.reason_kind as ReasonKind,
      summary: b.summary,
      detail: b.detail,
      blocked_work_ref: b.blocked_work_ref ?? null,
      resolution_mode: (b.resolution_mode ?? "pathways") as ResolutionMode,
      pathways: (b.pathways ?? null) as BlockerPathway[] | null,
      created_at:
        typeof b.created_at === "string" ? b.created_at : (b.created_at as Date).toISOString(),
    }));
}
