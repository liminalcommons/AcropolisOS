// M4.3: resolve_blocker_with_pathway action.
// Human picked one of the agent's curated paths. Sets resolved_via_pathway_id,
// flips status to resolved, backfills resolved_by_action_audit_id if available.
// Permissions: member_self (via blocker.blocked_actor_id).

import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";

const schema = z.object({
  blocker_id: z.string().uuid(),
  pathway_id: z.string().uuid(),
});

export default defineAction({
  schema,
  handler: async ({ params, ctx }) => {
    const row = await ctx.objects.AgentBlocker.findById(params.blocker_id);
    if (!row) {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (row.status !== "open") {
      return { ok: false as const, reason: "not_open" as const, status: row.status };
    }

    // Row ownership is enforced at the action permission level (member_self via
    // blocked_actor_id checked in enforceActionPermission). findById returning null
    // for cross-member would surface as not_found above.

    const resolvedAt = new Date().toISOString();
    await ctx.objects.AgentBlocker.update(params.blocker_id, {
      status: "resolved",
      resolved_at: resolvedAt,
      resolved_via_pathway_id: params.pathway_id,
    });

    // Notify the blocked principal so the agent can pick up the thread —
    // correct under steward-override too (recipient is the member, not the actor).
    if (ctx.notifications && row.blocked_actor_id) {
      await ctx.notifications.create({
        recipient_member_id: row.blocked_actor_id,
        kind: "agent_unblocked",
        title: `Resolved: ${row.summary}`,
        body: `Pathway ${params.pathway_id} selected for blocker ${row.id}`,
        link_url: `/me`,
      });
    }

    return { ok: true as const, blocker_id: row.id, pathway_id: params.pathway_id };
  },
});
