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
import { parseConfirmAction, toActionInvocation } from "@/lib/widgets/row-confirm";

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

// text_input mode: the human typed the missing datum. The textarea posts as
// `answer`; we wrap it as the JSON input_payload resolve_blocker_with_input
// expects. Steward-gated like the rest of the veto-queue.
export async function resolveWithInputAction(
  blockerId: string,
  form: FormData,
): Promise<void> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  if (runtime.actor?.role !== "steward") throw new Error("forbidden");
  const answer = ((form.get("answer") as string | null) ?? "").trim();
  if (!answer) return; // empty submit → no-op (the textarea is `required` client-side)
  await invokeAction({
    actionName: "resolve_blocker_with_input",
    params: { blocker_id: blockerId, input_payload: JSON.stringify({ value: answer }) },
    ctx: runtime.ctx,
    ontology: runtime.ontology,
    functionsDir: functionsDir(),
    sideEffectAdapters: getAdapters(),
  });
  revalidatePath("/veto-queue");
}

// confirm_binary mode: the human clicked Confirm. The action to run is DERIVED
// SERVER-SIDE from the blocker's own confirm_action column (never client-supplied
// — no injection surface), mapped {type,params}→{action_type,params} via the same
// bridge the board uses, then dispatched through resolve_blocker_with_custom.
// The `_form` arg is the FormData a `<form action>` always passes; unused here.
export async function confirmBlockerAction(
  blockerId: string,
  _form?: FormData,
): Promise<void> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  if (runtime.actor?.role !== "steward") throw new Error("forbidden");
  const row = (await (
    runtime.ctx.objects as unknown as {
      AgentBlocker: { findById(id: string): Promise<{ confirm_action?: unknown } | null> };
    }
  ).AgentBlocker.findById(blockerId)) ?? null;
  const rawSource =
    typeof row?.confirm_action === "string"
      ? row.confirm_action
      : JSON.stringify(row?.confirm_action ?? null);
  const parsed = parseConfirmAction(rawSource);
  if (!parsed) throw new Error("blocker has no confirm action");
  const invocation = toActionInvocation(parsed.action);
  await invokeAction({
    actionName: "resolve_blocker_with_custom",
    params: { blocker_id: blockerId, action_invocation: JSON.stringify(invocation) },
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
