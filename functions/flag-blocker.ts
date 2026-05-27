// M4.3: flag_blocker action.
// Agent-invoked — raises an AgentBlocker row for a specific human and writes
// a notification to their inbox. Steward-only permission (agent runs as steward).
// Dedupes on (blocked_actor_id, reason_kind, summary, blocked_work_ref) while status=open.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
import {
  parsePathways,
  computePathwayPreference,
  rankPathways,
} from "@/lib/blockers/pathway-preference";

const ReasonKind = z.enum([
  "approval",
  "confirmation",
  "ambiguity",
  "missing_data",
  "consent",
  "decision",
  "risky_action",
]);

const ResolutionMode = z.enum(["pathways", "text_input", "confirm_binary"]);

const schema = z.object({
  blocked_actor_id: z.string().uuid(),
  reason_kind: ReasonKind,
  summary: z.string().min(1).max(200),
  detail: z.string().min(1).max(4000),
  blocked_work_ref: z.string().optional(),
  resolution_mode: ResolutionMode.default("pathways"),
  pathways: z.unknown().optional(),
  input_schema: z.unknown().optional(),
  confirm_action: z.unknown().optional(),
});

export default defineAction({
  schema,
  handler: async ({ params, ctx }) => {
    // Dedupe: same actor + reason + summary + work_ref while open ⇒ return existing.
    const all = await ctx.objects.AgentBlocker.findMany();
    const existing = all.find(
      (b) =>
        b.status === "open" &&
        b.blocked_actor_id === params.blocked_actor_id &&
        b.reason_kind === params.reason_kind &&
        b.summary === params.summary &&
        (b.blocked_work_ref ?? null) === (params.blocked_work_ref ?? null),
    );
    if (existing) {
      return { ok: true as const, blocker_id: existing.id, deduped: true as const };
    }

    // Self-correction: rank incoming pathways by the community's past choices for
    // this reason_kind so the most-preferred option surfaces first.
    let resolvedPathways = params.pathways;
    if (
      params.resolution_mode === "pathways" &&
      Array.isArray(params.pathways) &&
      params.pathways.length > 0
    ) {
      const incoming = parsePathways(params.pathways);
      if (incoming.length > 0) {
        const preference = computePathwayPreference(all, params.reason_kind);
        resolvedPathways = rankPathways(incoming, preference);
      }
    }

    const now = new Date().toISOString();
    const row = await ctx.objects.AgentBlocker.create({
      id: randomUUID(),
      blocked_actor_id: params.blocked_actor_id,
      reason_kind: params.reason_kind,
      summary: params.summary,
      detail: params.detail,
      blocked_work_ref: params.blocked_work_ref,
      resolution_mode: params.resolution_mode,
      pathways: resolvedPathways !== undefined ? JSON.stringify(resolvedPathways) : undefined,
      input_schema: params.input_schema !== undefined ? JSON.stringify(params.input_schema) : undefined,
      confirm_action: params.confirm_action !== undefined ? JSON.stringify(params.confirm_action) : undefined,
      status: "open",
      created_at: now,
    });

    // Write notification directly to the BLOCKED actor, not the invoking agent.
    if (ctx.notifications) {
      await ctx.notifications.create({
        recipient_member_id: params.blocked_actor_id,
        kind: "agent_blocked",
        title: `Agent needs you: ${params.summary}`,
        body: params.detail,
        link_url: `/me#blocker-${row.id}`,
      });
    }

    return { ok: true as const, blocker_id: row.id, deduped: false as const };
  },
});
