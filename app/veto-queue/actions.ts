// Steward veto-queue server actions — resolve / dismiss a blocker org-wide.
// Same audited invokeAction path as /me, but steward-gated and revalidating
// /veto-queue (the /me actions hardcode revalidatePath("/me")).
"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { invokeAction } from "@/lib/actions/invoke";
import { resolveSideEffectAdapters } from "@/lib/actions/side-effects-runtime";
import { loadSideEffectConfigFromEnv } from "@/lib/actions/side-effects";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";

function functionsDir(): string {
  return path.join(process.env.ACROPOLISOS_PKG_ROOT ?? process.cwd(), "functions");
}

function getAdapters() {
  return resolveSideEffectAdapters(loadSideEffectConfigFromEnv(process.env));
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export async function resolveVetoAction(
  blockerId: string,
  pathwayIdOrForm?: string | FormData,
): Promise<void> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  if (runtime.actor?.role !== "steward") throw new Error("forbidden");
  const pathwayId =
    typeof pathwayIdOrForm === "string"
      ? pathwayIdOrForm
      : pathwayIdOrForm instanceof FormData
        ? ((pathwayIdOrForm.get("pathway_id") as string | null) ?? undefined)
        : undefined;
  await invokeAction({
    actionName: "resolve_blocker_with_pathway",
    params: { blocker_id: blockerId, pathway_id: pathwayId ?? ZERO_UUID },
    ctx: runtime.ctx,
    ontology: runtime.ontology,
    functionsDir: functionsDir(),
    sideEffectAdapters: getAdapters(),
  });
  revalidatePath("/veto-queue");
}

export async function dismissVetoAction(
  blockerId: string,
  reasonOrForm?: string | FormData,
): Promise<void> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  if (runtime.actor?.role !== "steward") throw new Error("forbidden");
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
  revalidatePath("/veto-queue");
}
