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

    const tierResult = (await ctx.actions.change_tier({
      member: params.member,
      new_tier: "lifetime",
    })) as { ok: boolean; previous_tier?: string; new_tier?: string };

    if (!tierResult.ok) {
      return {
        ok: false as const,
        reason: "change_tier_failed" as const,
        member: params.member,
        cause: tierResult,
      };
    }

    return {
      ok: true as const,
      member: params.member,
      previous_tier: tierResult.previous_tier,
      new_tier: tierResult.new_tier,
      promoted: true as const,
    };
  },
});
