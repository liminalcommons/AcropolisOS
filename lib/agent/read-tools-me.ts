// M4.3: /me agent read tools — query_member_context + query_my_blockers.
// Registered in the chat route tool map alongside apply_action + proposal tools.
// Both tools use the same permission-wrapped ctx as the rest of the runtime.

import { z } from "zod";
import { tool } from "ai";
import type { OntologyCtx } from "@/lib/ontology/ctx";
import type { Actor } from "@/lib/ctx";
import { getAgentBlockers } from "@/lib/me/fetchers/agent-blockers";
import { getOrCreateMemberContext } from "@/lib/me/fetchers/member-context";
import type { MeBundle, WidgetBundle } from "@/lib/me/widgets";
import type { Ontology } from "@/lib/ontology/schema";

export interface BuildMeReadToolsInput {
  ctx: OntologyCtx;
  actor: Actor;
  ontology: Ontology;
}

async function buildMeBundleForMember(
  ctx: OntologyCtx,
  actor: Actor,
  memberId: string,
): Promise<MeBundle> {
  const blockersBundle = await getAgentBlockers(ctx, memberId);

  // Inbox unread count (simple)
  const notifications = ctx.notifications
    ? await ctx.notifications.listForRecipient(actor, memberId).catch(() => [])
    : [];
  const unread = notifications.filter((n) => n.read_at === null);
  const inboxBundle: WidgetBundle = {
    id: "default:inbox_unread",
    kind: "inbox_unread",
    data: {
      unread_count: unread.length,
      items: unread.slice(0, 5).map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        created_at:
          n.created_at instanceof Date
            ? n.created_at.toISOString()
            : String(n.created_at),
      })),
    },
  };

  // MemberContext (pinned_widgets) — normalize jsonb array vs legacy text
  const mc = await getOrCreateMemberContext(ctx, memberId).catch(() => null);
  let pinnedWidgets: WidgetBundle[] = [];
  if (mc) {
    const raw = mc.pinned_widgets;
    let parsed: unknown[] | null = null;
    if (Array.isArray(raw)) {
      parsed = raw;
    } else if (typeof raw === "string") {
      try { const p = JSON.parse(raw); if (Array.isArray(p)) parsed = p; } catch { /* ignore */ }
    }
    if (parsed) {
      pinnedWidgets = (parsed as Array<{ id: string; kind: string }>).map(
        (w) => ({ id: w.id, kind: w.kind as WidgetBundle["kind"], data: {} as never }),
      );
    }
  }

  const widgets: WidgetBundle[] = [blockersBundle, inboxBundle, ...pinnedWidgets];

  return {
    member_id: memberId,
    rendered_at: new Date().toISOString(),
    widgets,
  };
}

export function buildMeReadTools({ ctx, actor, ontology: _ontology }: BuildMeReadToolsInput) {
  return {
    query_member_context: tool({
      description:
        "Return this member's /me widget bundle — agent_blockers, inbox_unread, and any " +
        "pinned widgets. Call this FIRST on open-ended self-directed questions ('what should I do?', " +
        "'what's on my plate?', 'help me', 'where are we?'). Read the agent_blockers widget so you " +
        "do NOT re-ask things already queued. Default member_id is the current actor.",
      inputSchema: z.object({
        member_id: z.string().uuid().optional(),
      }),
      execute: async (input: { member_id?: string }) => {
        const target = input.member_id ?? actor.userId;
        // Permission gate: non-stewards can only query own context.
        if (target !== actor.userId && actor.role !== "steward") {
          return { error: "forbidden: cannot read another member's context" };
        }
        return await buildMeBundleForMember(ctx, actor, target);
      },
    }),

    query_my_blockers: tool({
      description:
        "Agent-internal: return ALL open AgentBlocker rows the agent has flagged, grouped by " +
        "blocked_actor_id. Used to answer 'where am I stuck and on whom?'. Steward-only.",
      inputSchema: z.object({}),
      execute: async () => {
        if (actor.role !== "steward") {
          return { error: "forbidden: agent-only tool" };
        }
        const all = await ctx.objects.AgentBlocker.findMany();
        const open = all.filter((b) => b.status === "open");
        const grouped: Record<string, typeof open> = {};
        for (const b of open) {
          (grouped[b.blocked_actor_id] ??= []).push(b);
        }
        return { count: open.length, by_actor: grouped };
      },
    }),
  };
}
