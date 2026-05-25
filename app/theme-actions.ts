// P5: theme server actions — apply / reset member_context.theme_pref.
// The picker (components/shell/theme-switcher.tsx) live-previews a chosen preset
// client-side, then calls applyThemeAction to persist it (or resetThemeAction to
// clear the override so the user tracks the base palette).
//
// Write path mirrors app/dashboard/ask/actions.ts pinWidget: buildChatRuntime →
// resolve the actor's Member row via ctx.objects.Member → getOrCreateMemberContext
// → MemberContext.update. applyThemeAction re-checks isValidTokenSet as a defensive
// structural gate before persisting.

"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getOrCreateMemberContext } from "@/lib/me/fetchers/member-context";
import { getDb } from "@/lib/db/client";
import { member_context } from "@/lib/db/schema.generated";
import { isValidTokenSet, type TokenSet } from "@/lib/theme/tokens";
import type { ChatRuntime } from "@/lib/agent/chat-runtime";

// Resolve the actor's MemberContext. Returns null (no throw) when the caller is
// anonymous or has no Member row, so the picker degrades gracefully — the live
// preview already happened client-side; persistence simply no-ops rather than
// crashing the page with an error boundary.
async function resolveMemberContext(): Promise<{ runtime: ChatRuntime; memberId: string; mcId: string } | null> {
  const runtime = await buildChatRuntime();
  const actor = runtime.actor;
  if (isAnonymous(actor)) return null;
  const members = await runtime.ctx.objects.Member.findMany();
  const me = members.find((m) => m.id === actor.userId);
  if (!me) return null;
  const mc = await getOrCreateMemberContext(runtime.ctx, me.id);
  return { runtime, memberId: me.id, mcId: mc.id };
}

export async function applyThemeAction(tokens: TokenSet): Promise<{ ok: boolean }> {
  if (!isValidTokenSet(tokens)) return { ok: false };
  const resolved = await resolveMemberContext();
  if (!resolved) return { ok: false };
  await resolved.runtime.ctx.objects.MemberContext.update(resolved.mcId, {
    theme_pref: JSON.stringify(tokens),
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/");
  return { ok: true };
}

// reset — write theme_pref: null. The ontology MemberContext.update patch type is
// theme_pref?: string (no null), so use the raw drizzle path like compose_dashboard.
export async function resetThemeAction(): Promise<void> {
  const resolved = await resolveMemberContext();
  if (!resolved) return;
  const db = getDb();
  await db
    .update(member_context)
    .set({ theme_pref: null, updated_at: new Date() })
    .where(eq(member_context.member_id, resolved.memberId));
  revalidatePath("/");
}
