// M4.3: agent_blockers widget fetcher.
// Returns open AgentBlocker rows for a given member, filtered through the
// permission-wrapped ctx (member_self via blocked_actor_id — see ctx.ts rowOwnedBy).

import type { OntologyCtx } from "@/lib/ontology/ctx";
import type { WidgetBundle } from "../widgets";

export async function getAgentBlockers(
  ctx: OntologyCtx,
  memberId: string,
): Promise<Extract<WidgetBundle, { kind: "agent_blockers" }>> {
  const all = await ctx.objects.AgentBlocker.findMany();
  const blockers = all
    .filter((b) => b.blocked_actor_id === memberId && b.status === "open")
    .sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return tb - ta; // newest first
    })
    .map((b) => ({
      id: b.id,
      reason_kind: b.reason_kind as import("../widgets").ReasonKind,
      summary: b.summary,
      detail: b.detail,
      blocked_work_ref: b.blocked_work_ref ?? null,
      unblock_hint: b.unblock_hint as {
        action_type: string;
        suggested_params: Record<string, unknown>;
      } | null,
      created_at:
        typeof b.created_at === "string"
          ? b.created_at
          : (b.created_at as Date).toISOString(),
    }));

  return {
    id: "default:agent_blockers",
    kind: "agent_blockers",
    data: { blockers },
  };
}
