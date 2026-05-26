// Function-backed action: check_in
//
// Wired from ontology/action-types/check-in.yaml (`function: check-in`).
// The runner (lib/actions/function-backed.ts) resolves this file by filename,
// validates the descriptor, parses params through the schema, and invokes the
// handler with `{ params, ctx }`.
//
// Mirrors functions/change-tier.ts: a single ctx.objects.<Type>.update mutation
// guarded by a findById existence check. Permission ([steward, manager]) is
// enforced by the dispatcher (enforceActionPermission) BEFORE the handler runs,
// so the handler does not re-check the role — it inherits the fail-closed gate.
//
// agent_policy stays always_confirm in the YAML: apply_action returns
// confirmation_required until the human confirms. This handler is the body the
// confirm path (bypassConfirmation=true) dispatches to.

import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";

const schema = z.object({
  booking: z.string().min(1, "booking id is required"),
});

export default defineAction({
  schema,
  handler: async ({ params, ctx }) => {
    const booking = await ctx.objects.Booking.findById(params.booking);
    if (!booking) {
      return {
        ok: false as const,
        reason: "booking_not_found" as const,
        booking: params.booking,
      };
    }

    const updatedBooking = await ctx.objects.Booking.update(params.booking, {
      status: "checked_in",
    });
    if (!updatedBooking) {
      return {
        ok: false as const,
        reason: "update_failed" as const,
        booking: params.booking,
      };
    }

    // The booking references its Guest by id in `booking.guest`. Mirror the
    // booking's check-in onto the guest's current_status so the two stay
    // coherent. If the guest is missing/unreadable we still report the booking
    // change rather than failing the whole action.
    let guestStatus: string | null = null;
    if (booking.guest) {
      const updatedGuest = await ctx.objects.Guest.update(booking.guest, {
        current_status: "checked_in",
      });
      guestStatus = updatedGuest?.current_status ?? null;
    }

    return {
      ok: true as const,
      booking: params.booking,
      booking_status: updatedBooking.status,
      guest: booking.guest ?? null,
      guest_status: guestStatus,
      checked_in: true as const,
    };
  },
});
