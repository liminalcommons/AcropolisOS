// M4.3: pin_widget_to_member_context action.
// Appends a widget descriptor to the member's pinned_widgets array.
// The widget JSON is server-validated and assigned a pin_<uuid> id.
// Permissions: steward | member_self (via member_context.member_id).

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
import { WIDGET_KINDS, WidgetDescriptorSchema } from "@/lib/me/widgets";

const schema = z.object({
  member_id: z.string().uuid().optional(),
  widget: z.string().min(1),  // JSON-encoded { kind, config? }
});

export default defineAction({
  schema,
  handler: async ({ params, ctx }) => {
    const memberId = params.member_id ?? ctx.actor?.userId;
    if (!memberId) {
      return { ok: false as const, reason: "no_actor" as const };
    }

    // Parse the JSON-encoded widget input
    let rawWidget: unknown;
    try {
      rawWidget = JSON.parse(params.widget);
    } catch {
      return { ok: false as const, reason: "invalid_json" as const };
    }

    // Validate the widget kind
    const kindCheck = z.object({ kind: z.enum(WIDGET_KINDS) }).safeParse(rawWidget);
    if (!kindCheck.success) {
      return { ok: false as const, reason: "invalid_kind" as const };
    }

    // Get or create MemberContext
    const all = await ctx.objects.MemberContext.findMany();
    let mc = all.find((r) => r.member_id === memberId);

    const now = new Date().toISOString();
    if (!mc) {
      mc = await ctx.objects.MemberContext.create({
        id: randomUUID(),
        member_id: memberId,
        pinned_widgets: [],
        created_at: now,
        updated_at: now,
      });
    }

    // Normalize pinned_widgets: DB returns jsonb as array directly; legacy text gets parsed.
    let pinned: unknown[] = [];
    const raw = mc.pinned_widgets;
    if (Array.isArray(raw)) {
      pinned = raw;
    } else if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) pinned = parsed;
      } catch {
        // start fresh if corrupt
      }
    }

    const widget = {
      id: `pin_${randomUUID()}`,
      kind: kindCheck.data.kind,
      config: (rawWidget as Record<string, unknown>).config ?? {},
    };

    // Validate the full descriptor shape
    WidgetDescriptorSchema.parse(widget);

    const next = [...pinned, widget];
    // Store as array (DB is jsonb; in-memory store accepts unknown).
    await ctx.objects.MemberContext.update(mc.id, {
      pinned_widgets: next,
      updated_at: now,
    });

    return { ok: true as const, widget_id: widget.id };
  },
});
