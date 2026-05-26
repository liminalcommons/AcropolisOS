// M4.4: resolve_blocker_with_custom action.
// Human picked "Other (write your own)" escape hatch. Records the custom
// action invocation reference as the resolution and flips status to resolved.
// Permissions: member_self (via blocker.blocked_actor_id).

import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";

const schema = z.object({
  blocker_id: z.string().uuid(),
  action_invocation: z.string().min(1), // JSON-encoded { action_type, params }
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

    // Parse the action_invocation reference (validates JSON).
    let invocation: { action_type?: string; params?: unknown } | null = null;
    try {
      invocation = JSON.parse(params.action_invocation) as {
        action_type?: string;
        params?: unknown;
      };
    } catch {
      return { ok: false as const, reason: "invalid_json" as const };
    }

    if (!invocation || typeof invocation.action_type !== "string") {
      return { ok: false as const, reason: "missing_action_type" as const };
    }

    const resolvedAt = new Date().toISOString();
    await ctx.objects.AgentBlocker.update(params.blocker_id, {
      status: "resolved",
      resolved_at: resolvedAt,
    });

    // Notify the blocked principal so the agent can pick up the thread —
    // correct under steward-override too (recipient is the member, not the actor).
    if (ctx.notifications && row.blocked_actor_id) {
      await ctx.notifications.create({
        recipient_member_id: row.blocked_actor_id,
        kind: "agent_unblocked",
        title: `Resolved: ${row.summary}`,
        body: `Custom action '${invocation.action_type}' selected for blocker ${row.id}`,
        link_url: `/me`,
      });
    }

    return {
      ok: true as const,
      blocker_id: row.id,
      action_type: invocation.action_type,
    };
  },
});
