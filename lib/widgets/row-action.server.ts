"use server";

// Server action behind a data_table row's one-click affordance (e.g. the
// steward's "Dismiss Blocker" button on the /org veto queue).
//
// SECURITY (mirrors app/api/chat/confirm/route.ts, TIGHTENED):
//   1. Identity is resolved SERVER-SIDE via buildChatRuntime() — never trusted
//      from the client. Anonymous → unauthorized; non-steward → forbidden
//      (same interim steward gate as the confirm route).
//   2. The `action` MUST qualify as a one-click row action under the SAME rule
//      the derivation helper uses (single required ref param). This is the
//      tightening over the confirm route: only ontology-derived one-click
//      actions are invocable here, and params are constrained to the single
//      ref — the client cannot pass arbitrary params or arbitrary actions.
//   3. bypassConfirmation=true is correct: the steward physically clicking the
//      row Dismiss button IS the human confirmation for this always_confirm
//      action, exactly as the confirm route treats a Confirm click. The
//      dispatcher's enforceActionPermission still runs — bypassConfirmation
//      skips ONLY the always_confirm prompt, NOT the permission check.

import { revalidatePath } from "next/cache";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { createInProcessDispatcher } from "@/lib/actions/dispatcher";
import { runApplyActionTool } from "@/lib/agent/tool-gating";
import type { Ontology } from "@/lib/ontology/schema";
import { ROW_ACTION_SAFELIST } from "./row-actions";

export interface RowActionResult {
  ok: boolean;
  error?: string;
}

// SERVER-SIDE re-derivation of the one-click rule. Independent of the helper's
// catalog-type entry point: here we already know the action name, so we read
// its definition and confirm it qualifies, returning the single ref param name
// (and its target object-type) or null. Same structural rule as
// oneClickRowActionsForType — one rule, enforced again at the invocation gate.
function resolveRowActionRefParam(
  ontology: Ontology,
  action: string,
): string | null {
  // SECURITY: the structural rule alone admits privileged always_confirm actions
  // (promote_to_steward, check_in/out). Gate on the explicit safelist FIRST so
  // this bypassConfirmation endpoint can only ever invoke vetted row actions.
  if (!ROW_ACTION_SAFELIST.has(action)) return null;

  const def = ontology.action_types[action];
  if (!def?.parameters) return null;

  const params = def.parameters;
  const requiredNames = Object.keys(params).filter(
    (name) => params[name].required === true,
  );
  if (requiredNames.length !== 1) return null;

  const refParam = requiredNames[0];
  const prop = params[refParam];
  // Must be an INLINE ref (carries `type`/`target`); PropertyReference params
  // ({ ref }) never qualify.
  if (!("type" in prop) || prop.type !== "ref") return null;

  return refParam;
}

export async function invokeRowAction(
  action: string,
  objectId: string,
): Promise<RowActionResult> {
  const rt = await buildChatRuntime();

  // Fail-closed identity gate — identical to the confirm route.
  if (isAnonymous(rt.actor)) {
    return { ok: false, error: "unauthorized" };
  }
  if (rt.actor?.role !== "steward") {
    return { ok: false, error: "forbidden" };
  }

  // TIGHTENING: only ontology-derived one-click actions are invocable here.
  const refParam = resolveRowActionRefParam(rt.ontology, action);
  if (!refParam) {
    return { ok: false, error: "not_a_row_action" };
  }

  const dispatcher = createInProcessDispatcher({
    ctx: rt.ctx,
    ontology: rt.ontology,
    functionsDir: rt.functionsDir,
    sideEffectAdapters: rt.sideEffectAdapters,
  });

  // Params are CONSTRAINED to the single ref bound to the clicked row's id —
  // the client cannot smuggle extra params. bypassConfirmation=true: the click
  // is the confirmation; enforceActionPermission inside the dispatcher still gates.
  const result = await runApplyActionTool({
    actor: rt.actor,
    dispatcher,
    action,
    params: { [refParam]: objectId },
    policy: { ontology: rt.ontology, ctx: rt.ctx },
    bypassConfirmation: true,
  });

  if (result.ok !== true) {
    // Surface the structured dispatcher error (permission_denied etc.) so the
    // caller can distinguish a denied click from a successful dismiss.
    return { ok: false, error: result.error?.type ?? "failed" };
  }

  // Dismissed row's status flipped to "dismissed" → leaves the open-filtered
  // queue on next render.
  revalidatePath("/org");
  return { ok: true };
}

// Form-action adapter: the <form action={...}> prop requires a function whose
// return is void | Promise<void>. invokeRowAction returns a structured result
// (useful for non-form callers), so this thin "use server" wrapper bound by the
// card discards the result + the trailing FormData. Same gates run inside.
export async function invokeRowActionForm(
  action: string,
  objectId: string,
): Promise<void> {
  await invokeRowAction(action, objectId);
}
