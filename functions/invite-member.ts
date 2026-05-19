// Function-backed action: invite_member
//
// Wired from seed/small-community/action-types/invite-member.yaml. Generates
// a single-use invite code on a Member row, stamps an expiry, and returns
// `{ invite_code, claim_url }` — the claim_url ends up in the notify_member
// side-effect body (the dispatcher JSON-serializes the action result into
// `sendMail({ body })`), so any inbox/email channel surfaces the link
// without needing a YAML-level link_url_from indirection.
//
// Refuses to re-issue an invite when the target Member already has user_id
// set — a claimed account shouldn't have a fresh code minted under it.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";

// expires_in_days has a default in the YAML; the schema marks it optional
// here because ctx-runtime forwards the raw params record (US-029 / Mastra
// gotcha — defaults are NOT pre-applied to function-backed handler input).
const schema = z.object({
  member_id: z.string().min(1, "member_id is required"),
  expires_in_days: z.number().int().positive().optional(),
});

export class InviteMemberError extends Error {
  constructor(
    message: string,
    readonly code: "member_not_found" | "already_claimed",
  ) {
    super(message);
    this.name = "InviteMemberError";
  }
}

export default defineAction({
  schema,
  handler: async ({ params, ctx }) => {
    const target = await ctx.objects.Member.findById(params.member_id);
    if (!target) {
      throw new InviteMemberError(
        `member_not_found: ${params.member_id}`,
        "member_not_found",
      );
    }
    if (target.user_id) {
      throw new InviteMemberError(
        `already_claimed: member ${params.member_id} already has a user_id`,
        "already_claimed",
      );
    }

    const inviteCode = randomBytes(16).toString("hex"); // 32-char hex
    const days = params.expires_in_days ?? 7;
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);

    await ctx.objects.Member.update(params.member_id, {
      invite_code: inviteCode,
      invite_expires_at: expiresAt.toISOString(),
    });

    return {
      ok: true as const,
      invite_code: inviteCode,
      claim_url: `/claim?code=${inviteCode}`,
      expires_at: expiresAt.toISOString(),
      member_id: params.member_id,
    };
  },
});
