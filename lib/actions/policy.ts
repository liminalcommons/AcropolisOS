// US-026: Per-action policy gating.
//
// Resolves an action_type's YAML `agent_policy` into a runtime decision the
// agent's apply_action tool can act on:
//
//   auto_apply              → fire the action immediately
//   always_confirm          → surface a confirmation card; do NOT fire
//   confirm_if_unfamiliar   → if this actor has ≥ N prior successful
//                             invocations of this action with the same
//                             parameter SHAPE and the same primary target id,
//                             fire; otherwise confirm.
//                             (Default N = 3 — tunable via familiarityThreshold.)
//
// Default when the YAML field is absent: always_confirm. The schema already
// enforces this via zod's .default(), but resolveActionPolicy also handles
// missing fields defensively so callers wiring ad-hoc Ontology objects don't
// accidentally bypass the safer default.
//
// M3.8 #36: "Familiarity" now requires BOTH same param shape AND same target
// object id (the first id/uuid field in the params object). This closes the
// padding attack where an attacker accumulates ok-result invocations on dummy
// targets to satisfy the threshold, then strikes the real target unfamiliar.
//
// "Similar params" is interpreted as same param shape — same sorted set of
// top-level keys. Identical params would mean idempotency replay (handled
// upstream by audit-middleware) rather than familiarity. The shape match
// keeps the bar high enough that wildly-different invocations don't borrow
// each other's familiarity, while letting routine repeat-shape calls
// (e.g. add_member { full_name, email, tier }) graduate to auto_apply.

import type { AuditRow, AuditStore } from "../audit/writer";
import type { OntologyCtx } from "../ontology/ctx";
import type { AgentPolicy, Ontology } from "./../ontology/schema";

const DEFAULT_FAMILIARITY_THRESHOLD = 3;

export type PolicyDecision =
  | { decision: "auto_apply" }
  | {
      decision: "confirmation_required";
      reason: "always_confirm" | "unfamiliar";
      priorSuccessCount?: number;
    };

export interface ResolveActionPolicyInput {
  ontology: Ontology;
  actionName: string;
  params: unknown;
  ctx: OntologyCtx;
  familiarityThreshold?: number;
}

export async function resolveActionPolicy(
  input: ResolveActionPolicyInput,
): Promise<PolicyDecision> {
  const def = input.ontology.action_types[input.actionName];

  // Unknown action: don't trust it. Permission check downstream will reject
  // it anyway, but if anything ever bypasses that, fail safe to confirmation.
  if (!def) {
    return { decision: "confirmation_required", reason: "always_confirm" };
  }

  const policy: AgentPolicy =
    (def as { agent_policy?: AgentPolicy }).agent_policy ?? "always_confirm";

  if (policy === "auto_apply") {
    return { decision: "auto_apply" };
  }

  if (policy === "always_confirm") {
    return { decision: "confirmation_required", reason: "always_confirm" };
  }

  // confirm_if_unfamiliar
  const threshold = input.familiarityThreshold ?? DEFAULT_FAMILIARITY_THRESHOLD;
  const priorSuccessCount = await countSimilarPriorSuccesses({
    audit: input.ctx.audit,
    actorId: input.ctx.actor?.userId ?? null,
    actionName: input.actionName,
    params: input.params,
    // M3.8 #36: also pass the target id so we only count invocations on the
    // same target object, not on arbitrary same-shape dummy targets.
    targetId: primaryTargetId(input.params),
  });

  if (priorSuccessCount >= threshold) {
    return { decision: "auto_apply" };
  }
  return {
    decision: "confirmation_required",
    reason: "unfamiliar",
    priorSuccessCount,
  };
}

interface CountInput {
  audit: AuditStore | undefined;
  actorId: string | null;
  actionName: string;
  params: unknown;
  // M3.8 #36: primary target id extracted from params (may be null for
  // actions that don't target a specific object, e.g. add_member).
  targetId: string | null;
}

async function countSimilarPriorSuccesses(input: CountInput): Promise<number> {
  if (!input.audit) return 0;
  const expectedShape = paramShapeKey(input.params);
  const rows = await input.audit.listActionAudit();
  let count = 0;
  for (const row of rows) {
    if (!rowIsOkSuccess(row)) continue;
    if (row.subject_id !== input.actionName) continue;
    if (input.actorId && row.actor !== input.actorId) continue;
    const rowParams = (row.metadata as { params?: unknown }).params;
    if (paramShapeKey(rowParams) !== expectedShape) continue;
    // M3.8 #36: if the incoming call targets a specific object, only count
    // prior invocations that targeted the SAME object. This prevents an
    // attacker from padding the count with ok-result calls on dummy targets.
    if (input.targetId !== null) {
      const rowTargetId = primaryTargetId(rowParams);
      if (rowTargetId !== input.targetId) continue;
    }
    count++;
  }
  return count;
}

function rowIsOkSuccess(row: AuditRow): boolean {
  const meta = row.metadata as { result?: unknown };
  return meta.result === "ok";
}

// Stringify a stable shape descriptor for a params value. Plain objects map
// to their sorted top-level key list; arrays/primitives/null map to type
// tags. Two values are "shape-similar" iff their descriptors match.
function paramShapeKey(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value !== "object") return `primitive:${typeof value}`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `object:${keys.join(",")}`;
}

// M3.8 #36: Extract the primary target object id from action params.
//
// Convention: the target object id is stored in the first id-like field
// (checked in order: "id", "member_id", "event_id", "notification_id").
// Returns null for actions that don't target a specific existing object
// (e.g., add_member / invite_member where "id" is the new object's id, not
// a pre-existing target — but those actions are typically auto_apply or
// always_confirm, so confirm_if_unfamiliar threshold is never reached anyway).
//
// Returning null disables the same-target filter, letting shape-only counting
// apply — which is the pre-M3.8 behaviour, preserved as the safe fallback for
// actions whose params don't carry a recognisable target id field.
function primaryTargetId(params: unknown): string | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const p = params as Record<string, unknown>;
  for (const field of ["id", "member_id", "event_id", "notification_id"]) {
    const v = p[field];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
