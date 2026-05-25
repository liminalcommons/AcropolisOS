// P5: theme server actions — design (no persist) / apply / reset member_context.theme_pref.
// "use server" at top — Next.js requirement for server action files in app router.
//
// Write path mirrors app/dashboard/ask/actions.ts pinWidget: buildChatRuntime →
// isAnonymous guard → resolve the actor's Member row via ctx.objects.Member →
// getOrCreateMemberContext → MemberContext.update. The token JSON is governed by
// designTheme (structure + contrast) before it ever reaches here; applyThemeAction
// re-checks isValidTokenSet as a defensive structural gate.

"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getOrCreateMemberContext } from "@/lib/me/fetchers/member-context";
import { getDb } from "@/lib/db/client";
import { member_context } from "@/lib/db/schema.generated";
import { designTheme, type DesignThemeResult } from "@/lib/theme/design";
import { isValidTokenSet, type TokenSet } from "@/lib/theme/tokens";
import type { ChatRuntime } from "@/lib/agent/chat-runtime";

// Resolve the runtime, gate anonymous callers, and find the actor's Member row.
// Mirrors pinWidget's resolution exactly (member_id links to Member.id, which
// equals the actor's userId in this codebase).
async function resolveMemberContextId(): Promise<{ runtime: ChatRuntime; memberId: string; mcId: string }> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) {
    throw new Error("unauthorized");
  }
  const actor = runtime.actor;
  const ctx = runtime.ctx;

  const members = await ctx.objects.Member.findMany();
  const me = members.find((m) => m.id === actor.userId);
  if (!me) {
    throw new Error("no_member_row");
  }

  const mc = await getOrCreateMemberContext(ctx, me.id);
  return { runtime, memberId: me.id, mcId: mc.id };
}

// design ONLY — does not persist, so it needs auth but NOT a Member row. A signed-in
// user with no Member row can still preview a theme (the persist step needs the row).
async function requireSignedIn(): Promise<void> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) {
    throw new Error("unauthorized");
  }
}

export async function designThemeAction(prompt: string): Promise<DesignThemeResult> {
  await requireSignedIn();
  return designTheme({ prompt });
}

export async function applyThemeAction(tokens: TokenSet): Promise<{ ok: boolean }> {
  const { runtime, mcId } = await resolveMemberContextId();
  if (!isValidTokenSet(tokens)) return { ok: false };
  await runtime.ctx.objects.MemberContext.update(mcId, {
    theme_pref: JSON.stringify(tokens),
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/");
  return { ok: true };
}

// reset — write theme_pref: null. The ontology MemberContext.update patch type is
// theme_pref?: string (no null), so use the raw drizzle path like compose_dashboard.
export async function resetThemeAction(): Promise<void> {
  const { memberId } = await resolveMemberContextId();
  const db = getDb();
  await db
    .update(member_context)
    .set({ theme_pref: null, updated_at: new Date() })
    .where(eq(member_context.member_id, memberId));
  revalidatePath("/");
}
