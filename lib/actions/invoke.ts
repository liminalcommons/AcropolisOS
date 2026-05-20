// US-029: Action composition entrypoint.
//
// Single unified runner that wraps any action invocation with the audit
// envelope, dispatches to the declarative or function-backed handler, and
// exposes a `ctx.actions.X(params)` accessor so handlers can compose other
// actions while preserving:
//   - actor context (no impersonation across the call tree)
//   - parent_action_audit_id (call-tree visibility in action_audit)
//   - idempotency keys (each composed child gets its own key)
//
// Composition is in-process — a nested call runs inside the parent's
// Inngest step rather than fanning out to a child event — so the audit log
// IS the call tree. Future stories can promote nested calls to events if
// step-level durability per child is needed.

import type { OntologyCtx } from "../ontology/ctx";
import type { ActionType, Ontology } from "../ontology/schema";
import {
  auditPostInvocation,
  auditPreInvocation,
} from "./audit-middleware";
import { runDeclarativeAction } from "./declarative";
import { runFunctionBackedAction } from "./function-backed";
import { enforceActionPermission } from "./permission-check";
import {
  dispatchSideEffects,
  type SideEffectAdapters,
} from "./side-effects";

export interface InvokeActionInput {
  actionName: string;
  params: unknown;
  ctx: OntologyCtx;
  ontology: Ontology;
  functionsDir: string;
  parentAuditId?: string;
  // US-028: optional side-effect adapters. When omitted, side-effect
  // dispatch is skipped — keeps tests + bare invocations unchanged.
  sideEffectAdapters?: SideEffectAdapters;
  // M2.5: current call depth (root = 0). Increments through
  // ctx.actions.X composition. Rejected when it would exceed MAX_DEPTH.
  // Callers should NOT pass this — it's threaded automatically.
  depth?: number;
}

// Cap composition chain length. 5 is generous: every real composing action
// in the seed today is 1-2 deep. A handler hitting 6 is almost certainly a
// runaway self-call, not a legitimate workflow.
export const MAX_COMPOSITION_DEPTH = 5;

export class CompositionDepthExceededError extends Error {
  constructor(
    readonly actionName: string,
    readonly depth: number,
    readonly maxDepth: number,
  ) {
    super(
      `composition depth ${depth} exceeds maximum ${maxDepth} (last action: "${actionName}")`,
    );
    this.name = "CompositionDepthExceededError";
  }
}

function isFunctionBacked(def: ActionType): def is ActionType & { function: string } {
  return typeof def.function === "string" && def.function.length > 0;
}

export async function invokeAction(input: InvokeActionInput): Promise<unknown> {
  const {
    actionName,
    params,
    ctx,
    ontology,
    functionsDir,
    parentAuditId,
    sideEffectAdapters,
    depth = 0,
  } = input;

  const def = ontology.action_types[actionName];
  if (!def) {
    throw new Error(
      `invokeAction: unknown action "${actionName}" (not in ontology.action_types)`,
    );
  }

  if (depth > MAX_COMPOSITION_DEPTH) {
    // Throw BEFORE audit_pre so we don't write a pending row for a call we
    // refuse to execute. The throw still unwinds through any enclosing
    // parent's audit_post(error), so the chain is visible in audit.
    throw new CompositionDepthExceededError(
      actionName,
      depth,
      MAX_COMPOSITION_DEPTH,
    );
  }

  const pre = await auditPreInvocation({
    ctx,
    actionName,
    params,
    parentAuditId,
  });
  if (pre.kind === "replay") {
    return pre.priorResult;
  }

  // M4.3: pass params so member_self ref-ownership checks (e.g. resolve/dismiss blocker)
  // can resolve the target row and verify blocked_actor_id === actor.userId.
  await enforceActionPermission({ ontology, actionName, ctx, params });

  // Build a child ctx so any ctx.actions.X calls made INSIDE this handler
  // record THIS action's pending row as their parent. When the audit store
  // is absent, pendingAuditId is null; we still propagate the caller's
  // parentAuditId so deeper nesting keeps the link to whatever root has one.
  const childParentId = pre.pendingAuditId ?? parentAuditId;
  const childCtx: OntologyCtx = {
    ...ctx,
    actions: createActionsDispatcher({
      ctx,
      ontology,
      functionsDir,
      parentAuditId: childParentId,
      sideEffectAdapters,
      depth: depth + 1,
    }) as unknown as OntologyCtx["actions"],
  };

  const startedAt = Date.now();
  try {
    const result = isFunctionBacked(def)
      ? await runFunctionBackedAction({
          functionName: def.function,
          functionsDir,
          params,
          ctx: childCtx,
        })
      : await runDeclarativeAction({
          actionName,
          ontology,
          params,
          ctx: childCtx,
        });

    await auditPostInvocation({
      ctx,
      actionName,
      params,
      pendingAuditId: pre.pendingAuditId,
      idempotencyKey: pre.idempotencyKey,
      parentAuditId,
      status: "ok",
      durationMs: Date.now() - startedAt,
      result,
    });
    if (sideEffectAdapters) {
      // Failures are captured per-channel inside the dispatcher; the
      // returned summary intentionally is not surfaced from invokeAction
      // so the action's contract stays tied to its handler's return value.
      await dispatchSideEffects({
        ctx,
        ontology,
        actionName,
        params,
        result,
        auditId: pre.pendingAuditId ?? undefined,
        adapters: sideEffectAdapters,
      });
    }
    return result;
  } catch (err) {
    await auditPostInvocation({
      ctx,
      actionName,
      params,
      pendingAuditId: pre.pendingAuditId,
      idempotencyKey: pre.idempotencyKey,
      parentAuditId,
      status: "error",
      durationMs: Date.now() - startedAt,
      error: err,
    });
    throw err;
  }
}

export interface CreateActionsDispatcherInput {
  ctx: OntologyCtx;
  ontology: Ontology;
  functionsDir: string;
  parentAuditId?: string;
  sideEffectAdapters?: SideEffectAdapters;
  // M2.5: depth handed to invokeAction for each child call. Defaults to 0
  // when this dispatcher is the root entrypoint (no enclosing invokeAction).
  depth?: number;
}

export type ActionsDispatcher = Record<
  string,
  (params: unknown) => Promise<unknown>
>;

// Build a `ctx.actions.X(params)` map dynamically over the ontology so
// handlers can compose other actions. Each call routes through invokeAction
// and propagates parentAuditId, preserving the call tree in audit rows.
export function createActionsDispatcher(
  input: CreateActionsDispatcherInput,
): ActionsDispatcher {
  const {
    ctx,
    ontology,
    functionsDir,
    parentAuditId,
    sideEffectAdapters,
    depth = 0,
  } = input;
  const dispatcher: ActionsDispatcher = {};
  for (const actionName of Object.keys(ontology.action_types)) {
    dispatcher[actionName] = (params: unknown) =>
      invokeAction({
        actionName,
        params,
        ctx,
        ontology,
        functionsDir,
        parentAuditId,
        sideEffectAdapters,
        depth,
      });
  }
  return dispatcher;
}
