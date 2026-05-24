// Function-backed action: change_tier
//
// Wired from seed/small-community/ontology/action-types/change-tier.yaml
// (`function: change-tier`). The runner (lib/actions/function-backed.ts)
// resolves this file by filename, validates the descriptor, parses params,
// and invokes the handler with `{ params, ctx }`.

import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";

const schema = z.object({
  member: z.string().min(1, "member id is required"),
  new_tier: z.enum(["work_trader", "staff", "supervisor", "manager"]),
});

export default defineAction({
  schema,
  handler: async ({ params, ctx }) => {
    const before = await ctx.objects.Member.findById(params.member);
    if (!before) {
      return {
        ok: false as const,
        reason: "member_not_found" as const,
        member: params.member,
      };
    }
    const updated = await ctx.objects.Member.update(params.member, {
      tier_role: params.new_tier,
    });
    return {
      ok: true as const,
      member: params.member,
      previous_tier: before.tier_role,
      new_tier: updated?.tier_role ?? params.new_tier,
    };
  },
});
