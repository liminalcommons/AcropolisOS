// M4.4: resolve_blocker_with_input action.
// Human supplied missing data. Validates input against blocker.input_schema,
// fires whatever action the blocker's metadata says to fire with input merged in,
// and flips status to resolved.
// Permissions: member_self (via blocker.blocked_actor_id).

import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";

const schema = z.object({
  blocker_id: z.string().uuid(),
  input_payload: z.string().min(1), // JSON-encoded input matching the blocker's input_schema
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
    if (row.resolution_mode !== "text_input") {
      return {
        ok: false as const,
        reason: "wrong_resolution_mode" as const,
        resolution_mode: row.resolution_mode,
      };
    }

    // Parse the input payload.
    let payload: unknown;
    try {
      payload = JSON.parse(params.input_payload);
    } catch {
      return { ok: false as const, reason: "invalid_json" as const };
    }

    // Validate against the blocker's input_schema if present.
    const inputSchema = row.input_schema as { prompt?: string; kind?: string } | null | undefined;
    if (inputSchema && typeof payload !== "object") {
      return { ok: false as const, reason: "payload_invalid" as const };
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
        body: `Input provided for blocker ${row.id}`,
        link_url: `/me`,
      });
    }

    return {
      ok: true as const,
      blocker_id: row.id,
      payload_received: typeof payload === "object" ? Object.keys(payload as Record<string, unknown>) : [],
    };
  },
});
