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
import type { OntologyCtx } from "@/lib/ontology/ctx";
import { rowActionRefParamFor } from "./row-actions";
import { rowResolverFor } from "./row-resolver";

export interface RowActionResult {
  ok: boolean;
  error?: string;
}

// The invocation gate: confirm `action` opts in (`row_action: true`) AND matches
// the one-click structural rule, returning the ref param to bind the row id to.
// Uses the SHARED rowActionRefParamFor — the SAME impl the render helper builds
// on — so the security boundary (server) cannot drift from what renders. The
// opt-in excludes privileged always_confirm actions (promote_to_steward,
// check_in/out) from this bypassConfirmation endpoint.
function resolveRowActionRefParam(
  ontology: Ontology,
  action: string,
): string | null {
  const def = ontology.action_types[action];
  if (!def) return null;
  return rowActionRefParamFor(def);
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

// ── Row RESOLVER (the "Confirm half": a per-row CHOICE picker) ─────────────────
//
// Server action behind a data_table row's per-row choice picker (e.g. the
// steward picking ONE of the agent's curated pathways on the /org veto queue).
//
// SECURITY (mirrors invokeRowAction, with ONE ADDED CONTROL — choice membership):
//   1. Identity resolved SERVER-SIDE via buildChatRuntime(). Anonymous →
//      unauthorized; non-steward → forbidden.
//   2. The `action` MUST declare a `row_resolver` AND match the structural
//      choice-driven rule (single required ref + the required choice_param) —
//      the SAME rule the render helper uses (rowResolverFor). Only such actions
//      are invocable here; params are constrained to {refParam, choiceParam}.
//   3. MEMBERSHIP VALIDATION (the key control): the chosen choiceId must be the
//      id of one of the row's CURATED choices (parsed from obj[choicesFrom]).
//      This stops a caller invoking the resolver with an ARBITRARY pathway_id —
//      they may only pick a real option the agent curated. Parsed defensively.
//   4. bypassConfirmation=true is correct: the steward clicking a SPECIFIC
//      curated pathway IS the human confirmation for this always_confirm
//      action. The dispatcher's enforceActionPermission still runs.

// Map a PascalCase ontology object-type name (the ref param's `target`) to the
// ctx.objects accessor key — they are identical (ctx.objects is keyed by the
// PascalCase type name), so this is a typed narrowing, not a transform.
function objectAccessFor(
  ctx: OntologyCtx,
  targetType: string,
): { findById(id: string): Promise<Record<string, unknown> | null> } | null {
  const objects = ctx.objects as unknown as Record<
    string,
    { findById(id: string): Promise<Record<string, unknown> | null> } | undefined
  >;
  return objects[targetType] ?? null;
}

export async function invokeRowResolver(
  action: string,
  objectId: string,
  choiceId: string,
): Promise<RowActionResult> {
  const rt = await buildChatRuntime();

  // Fail-closed identity gate — identical to invokeRowAction.
  if (isAnonymous(rt.actor)) {
    return { ok: false, error: "unauthorized" };
  }
  if (rt.actor?.role !== "steward") {
    return { ok: false, error: "forbidden" };
  }

  // Only ontology-declared row resolvers are invocable here (opt-in + structural).
  const def = rt.ontology.action_types[action];
  const resolver = rowResolverFor(def);
  if (!resolver) {
    return { ok: false, error: "not_a_resolver" };
  }

  // LOAD the object generically: the resolver's ref param target type. The
  // findById is permission-checked (ctx.objects) — a row the steward cannot
  // read returns null and we fail not_found, no leak.
  const refProp = def!.parameters![resolver.refParam];
  if (!("type" in refProp) || refProp.type !== "ref") {
    return { ok: false, error: "not_a_resolver" };
  }
  const access = objectAccessFor(rt.ctx, refProp.target);
  if (!access) {
    return { ok: false, error: "not_found" };
  }
  const obj = await access.findById(objectId);
  if (!obj) {
    return { ok: false, error: "not_found" };
  }

  // MEMBERSHIP VALIDATION — the chosen id must be one of the row's curated
  // choices (obj[choicesFrom] is a JSON string of [{id,label}]). Parsed
  // defensively: anything that isn't an array of objects with a matching `id`
  // is an invalid_choice. This is the control that prevents an arbitrary
  // choiceId from reaching the always_confirm action.
  const rawChoices = obj[resolver.choicesFrom];
  let isMember = false;
  if (typeof rawChoices === "string") {
    try {
      const parsed = JSON.parse(rawChoices) as unknown;
      if (Array.isArray(parsed)) {
        isMember = parsed.some(
          (c) =>
            c != null &&
            typeof c === "object" &&
            (c as { id?: unknown }).id === choiceId,
        );
      }
    } catch {
      // non-JSON / corrupt → not a member (fail-closed)
    }
  }
  if (!isMember) {
    return { ok: false, error: "invalid_choice" };
  }

  const dispatcher = createInProcessDispatcher({
    ctx: rt.ctx,
    ontology: rt.ontology,
    functionsDir: rt.functionsDir,
    sideEffectAdapters: rt.sideEffectAdapters,
  });

  // Params CONSTRAINED to {refParam: objectId, choiceParam: choiceId} — the
  // client cannot smuggle extra params. bypassConfirmation=true: the steward's
  // click on a specific curated pathway IS the confirmation;
  // enforceActionPermission inside the dispatcher still gates.
  const result = await runApplyActionTool({
    actor: rt.actor,
    dispatcher,
    action,
    params: { [resolver.refParam]: objectId, [resolver.choiceParam]: choiceId },
    policy: { ontology: rt.ontology, ctx: rt.ctx },
    bypassConfirmation: true,
  });

  if (result.ok !== true) {
    return { ok: false, error: result.error?.type ?? "failed" };
  }

  // Resolved blocker's status flips to "resolved" → leaves the open-filtered
  // queue on next render.
  revalidatePath("/org");
  return { ok: true };
}

// Form-action adapter (mirrors invokeRowActionForm): discards the structured
// result + trailing FormData so it satisfies the <form action={...}> prop's
// void|Promise<void> contract. Same gates run inside.
export async function invokeRowResolverForm(
  action: string,
  objectId: string,
  choiceId: string,
): Promise<void> {
  await invokeRowResolver(action, objectId, choiceId);
}
