// M4.3: server actions for /me — resolve, dismiss, pin, unpin.
// ALL actions gate on isAnonymous (mirror /inbox/actions.ts M3.8 #38 pattern).
// Session actor is ALWAYS used — never ANONYMOUS_ACTOR.

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

function getAdapters() {
  return resolveSideEffectAdapters(loadSideEffectConfigFromEnv(process.env));
}

export async function resolveBlockerAction(
  blockerId: string,
  pathwayIdOrForm?: string | FormData,
): Promise<void> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  // Second arg may be a plain string (direct call) or FormData (form action
  // bound with `resolveBlockerAction.bind(null, b.id)`). When FormData, look
  // for a `pathway_id` field; missing field falls back to the empty sentinel.
  const pathwayId =
    typeof pathwayIdOrForm === "string"
      ? pathwayIdOrForm
      : pathwayIdOrForm instanceof FormData
        ? ((pathwayIdOrForm.get("pathway_id") as string | null) ?? undefined)
        : undefined;
  await invokeAction({
    actionName: "resolve_blocker_with_pathway",
    params: {
      blocker_id: blockerId,
      pathway_id: pathwayId ?? "00000000-0000-0000-0000-000000000000",
    },
    ctx: runtime.ctx,
    ontology: runtime.ontology,
    functionsDir: functionsDir(),
    sideEffectAdapters: getAdapters(),
  });
  revalidatePath("/me");
}

export async function dismissBlockerAction(
  blockerId: string,
  reasonOrForm?: string | FormData,
): Promise<void> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  const reason =
    typeof reasonOrForm === "string"
      ? reasonOrForm
      : reasonOrForm instanceof FormData
        ? ((reasonOrForm.get("reason") as string | null) ?? undefined)
        : undefined;
  await invokeAction({
    actionName: "dismiss_blocker",
    params: { blocker_id: blockerId, reason },
    ctx: runtime.ctx,
    ontology: runtime.ontology,
    functionsDir: functionsDir(),
    sideEffectAdapters: getAdapters(),
  });
  revalidatePath("/me");
}

export async function pinWidgetAction(widgetJson: string | FormData): Promise<void> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  // Handle both direct call (string) and form action (FormData with "widget" key)
  const json =
    typeof widgetJson === "string"
      ? widgetJson
      : (widgetJson.get("widget") as string | null) ?? "{}";
  await invokeAction({
    actionName: "pin_widget_to_member_context",
    params: { widget: json },
    ctx: runtime.ctx,
    ontology: runtime.ontology,
    functionsDir: functionsDir(),
    sideEffectAdapters: getAdapters(),
  });
  revalidatePath("/me");
}

export async function unpinWidgetAction(widgetId: string): Promise<void> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  await invokeAction({
    actionName: "unpin_widget_from_member_context",
    params: { widget_id: widgetId },
    ctx: runtime.ctx,
    ontology: runtime.ontology,
    functionsDir: functionsDir(),
    sideEffectAdapters: getAdapters(),
  });
  revalidatePath("/me");
}
