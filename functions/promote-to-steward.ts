// Function-backed action: promote_to_steward
//
// Wired from seed/small-community/action-types/promote-to-steward.yaml
// (`function: promote-to-steward`). This is the M2.5 reference for
// in-process action composition: the handler invokes change_tier through
// ctx.actions.X, which routes through invokeAction → audit-pre, recording
// parent_action_audit_id back to this row.
//
// notify_member fires as a side-effect (declared in the YAML), not as a
// nested action — same parent_action_audit_id field on the child audit row
// makes the call tree look identical in /audit.

import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";

const schema = z.object({
  member: z.string().min(1, "member id is required"),
});

export default defineAction({
  schema,
  handler: async ({ params, ctx }) => {
    const target = await ctx.objects.Member.findById(params.member);
    if (!target) {
      return {
        ok: false as const,
        reason: "member_not_found" as const,
        member: params.member,
      };
    }

    const previousTierRole = target.tier_role;
    const updated = await ctx.objects.Member.update(params.member, {
      tier_role: "manager",
    });

    if (!updated) {
      return {
        ok: false as const,
        reason: "update_failed" as const,
        member: params.member,
      };
    }

    return {
      ok: true as const,
      member: params.member,
      previous_tier: previousTierRole,
      new_tier: updated.tier_role,
      promoted: true as const,
    };
  },
});
