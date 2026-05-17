// US-027: apply_action dispatcher.
//
// `createInProcessDispatcher` returns an `ApplyActionDispatcher` (the
// signature `getToolsForActor` expects) that:
//   1. Runs the action through `invokeAction` — the same code path the
//      per-action Inngest function uses (audit pre/post middleware +
//      permission check + declarative/function-backed handler).
//   2. Returns a `{result, audit_id}` envelope. `runApplyActionTool`
//      lifts the envelope into `ApplyActionResult.audit_id` so the chat
//      panel can render a structured "Action recorded" card linking to
//      the action_audit row.
//
// The Inngest functions registered in lib/inngest/declarative-actions.generated.ts
// remain the durable, externally-triggered path. The in-process dispatcher
// short-circuits to the same handler so the agent gets a synchronous result
// without waiting on an Inngest fan-out.

import { invokeAction } from "./invoke";
import type { OntologyCtx } from "../ontology/ctx";
import type { Ontology } from "../ontology/schema";
import type { SideEffectAdapters } from "./side-effects";

export interface DispatchedAction {
  result: unknown;
  audit_id: string | null;
}

export interface CreateInProcessDispatcherInput {
  ctx: OntologyCtx;
  ontology: Ontology;
  functionsDir: string;
  sideEffectAdapters?: SideEffectAdapters;
}

export function isDispatchedActionEnvelope(
  value: unknown,
): value is DispatchedAction {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!("result" in v) || !("audit_id" in v)) return false;
  const auditId = v.audit_id;
  return auditId === null || typeof auditId === "string";
}

export function createInProcessDispatcher(
  input: CreateInProcessDispatcherInput,
): (call: { action: string; params: unknown }) => Promise<DispatchedAction> {
  const { ctx, ontology, functionsDir, sideEffectAdapters } = input;
  return async (call) => {
    const beforeCount = ctx.audit ? (await ctx.audit.listActionAudit()).length : 0;
    const result = await invokeAction({
      actionName: call.action,
      params: call.params,
      ctx,
      ontology,
      functionsDir,
      ...(sideEffectAdapters ? { sideEffectAdapters } : {}),
    });
    // The audit_id we surface is the post-completion row written by
    // audit-middleware (status === "ok"), not the pending pre-row. That row
    // is what the chat card should link to — its metadata carries the
    // captured_result, duration, and idempotency key.
    let auditId: string | null = null;
    if (ctx.audit) {
      const rows = await ctx.audit.listActionAudit();
      for (let i = rows.length - 1; i >= beforeCount; i--) {
        const row = rows[i];
        if (
          row.subject_id === call.action &&
          row.metadata.result === "ok"
        ) {
          auditId = row.id;
          break;
        }
      }
    }
    return { result, audit_id: auditId };
  };
}
