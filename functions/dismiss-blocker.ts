// M4.3: dismiss_blocker action.
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";

const schema = z.object({
  blocker_id: z.string().uuid(),
  reason: z.string().optional(),
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
    await ctx.objects.AgentBlocker.update(params.blocker_id, {
      status: "dismissed",
    });
    // Notify the blocked principal (not the dismisser) so the agent working on
    // their behalf learns it was cleared — correct under steward-override too.
    if (ctx.notifications && row.blocked_actor_id) {
      await ctx.notifications.create({
        recipient_member_id: row.blocked_actor_id,
        kind: "agent_unblocked",
        title: `Dismissed: ${row.summary}`,
        body: params.reason ? `Dismissed: ${params.reason}` : `Blocker ${row.id} dismissed`,
        link_url: `/me`,
      });
    }
    return { ok: true as const, blocker_id: row.id };
  },
});
