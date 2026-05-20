// M4.1 step-5: server actions for /inbox.
//
// These call the mark_notification_read action through the full
// invokeAction pipeline so audit + permission enforcement run on every
// click — the route surface is just a thin transport.

"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { invokeAction } from "@/lib/actions/invoke";
import { resolveSideEffectAdapters } from "@/lib/actions/side-effects-runtime";
import { loadSideEffectConfigFromEnv } from "@/lib/actions/side-effects";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";

function functionsDir(): string {
  return path.join(
    process.env.ACROPOLISOS_PKG_ROOT ?? process.cwd(),
    "functions",
  );
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<void> {
  const runtime = await buildChatRuntime();
  // M3.8 (#38): server actions are POSTable from any origin; an
  // anonymous caller could otherwise mark notifications as read on
  // someone else's inbox via the steward-local sentinel. Refuse before
  // we invoke the action.
  if (isAnonymous(runtime.actor)) {
    throw new Error("unauthorized");
  }
  const adapters = resolveSideEffectAdapters(
    loadSideEffectConfigFromEnv(process.env),
  );
  await invokeAction({
    actionName: "mark_notification_read",
    params: { notification_id: notificationId },
    ctx: runtime.ctx,
    ontology: runtime.ontology,
    functionsDir: functionsDir(),
    sideEffectAdapters: adapters,
  });
  revalidatePath("/inbox");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const runtime = await buildChatRuntime();
  // M3.8 (#38): refuse anonymous before touching the store.
  if (isAnonymous(runtime.actor)) {
    throw new Error("unauthorized");
  }
  if (!runtime.ctx.notifications || !runtime.actor?.userId) {
    return;
  }
  // Bulk mark uses the store directly: invoking the per-row action N times
  // would write N audit rows, blow up dispatch, and serialize on Postgres
  // round-trips. The single-row action is the one we want auditable; "mark
  // all" is an inbox-UI affordance, audit-light by design.
  await runtime.ctx.notifications.markAllRead(runtime.actor.userId);
  revalidatePath("/inbox");
}
