// M4.1 step-4: function-backed action mark_notification_read.
//
// Wired from seed/small-community/action-types/mark-notification-read.yaml
// (`function: mark-notification-read`). Sets read_at = now() on a single
// Notification row. Enforces member_self at the row level: the action-level
// permission token "member_self" passes any authenticated actor, but the
// handler additionally refuses when the actor is not the notification's
// recipient — a member cannot mark someone else's inbox row as read.
// Stewards bypass the ownership check (steward is also in permissions).

import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";

const schema = z.object({
  notification_id: z.string().min(1, "notification_id is required"),
});

export default defineAction({
  schema,
  handler: async ({ params, ctx }) => {
    if (!ctx.notifications) {
      return {
        ok: false as const,
        reason: "notifications_unavailable" as const,
      };
    }
    const actor = ctx.actor;
    if (!actor?.userId) {
      return { ok: false as const, reason: "unauthenticated" as const };
    }

    const existing = await ctx.notifications.findById(params.notification_id);
    if (!existing) {
      return {
        ok: false as const,
        reason: "not_found" as const,
        notification_id: params.notification_id,
      };
    }

    // Row-level member_self ownership. Stewards bypass.
    const isOwner = existing.recipient_member_id === actor.userId;
    const isSteward = actor.role === "steward";
    if (!isOwner && !isSteward) {
      return {
        ok: false as const,
        reason: "not_recipient" as const,
        notification_id: params.notification_id,
      };
    }

    // Pass actor so the store-level permission check (#27) can enforce
    // member_self / steward. The ownership check above already ran, but
    // the store assertion is defense-in-depth.
    const updated = await ctx.notifications.markRead(
      actor,
      existing.id,
      existing.recipient_member_id,
    );
    if (!updated) {
      return {
        ok: false as const,
        reason: "update_failed" as const,
        notification_id: existing.id,
      };
    }

    return {
      ok: true as const,
      notification_id: updated.id,
      recipient_member_id: updated.recipient_member_id,
      read_at:
        updated.read_at instanceof Date
          ? updated.read_at.toISOString()
          : null,
    };
  },
});
