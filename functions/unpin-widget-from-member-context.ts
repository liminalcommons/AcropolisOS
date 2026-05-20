// M4.3: unpin_widget_from_member_context action.
// Removes a pinned widget by id. Default widgets (prefix "default:") are
// unaffected — filtering them out is a no-op + ok:false.
// Permissions: steward | member_self (via member_context.member_id).

import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";

const schema = z.object({
  member_id: z.string().uuid().optional(),
  widget_id: z.string().min(1),
});

export default defineAction({
  schema,
  handler: async ({ params, ctx }) => {
    const memberId = params.member_id ?? ctx.actor?.userId;
    if (!memberId) {
      return { ok: false as const, reason: "no_actor" as const };
    }

    // Default widget protection
    if (params.widget_id.startsWith("default:")) {
      return { ok: false as const, reason: "cannot_unpin_default" as const };
    }

    const all = await ctx.objects.MemberContext.findMany();
    const mc = all.find((r) => r.member_id === memberId);
    if (!mc) {
      return { ok: false as const, reason: "no_context" as const };
    }

    let pinned: Array<{ id: string; [k: string]: unknown }> = [];
    const rawWidgets = mc.pinned_widgets;
    if (Array.isArray(rawWidgets)) {
      pinned = rawWidgets as typeof pinned;
    } else if (typeof rawWidgets === "string") {
      try {
        const parsed = JSON.parse(rawWidgets);
        if (Array.isArray(parsed)) pinned = parsed as typeof pinned;
      } catch {
        // corrupt — treat as empty
      }
    }

    const before = pinned.length;
    const next = pinned.filter((w) => w.id !== params.widget_id);
    if (next.length === before) {
      return { ok: false as const, reason: "not_found" as const };
    }

    const now = new Date().toISOString();
    await ctx.objects.MemberContext.update(mc.id, {
      pinned_widgets: JSON.stringify(next),
      updated_at: now,
    });

    return { ok: true as const, widget_id: params.widget_id };
  },
});
