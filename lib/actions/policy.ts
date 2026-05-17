// US-026: Per-action policy gating.
//
// Resolves an action_type's YAML `agent_policy` into a runtime decision the
// agent's apply_action tool can act on:
//
//   auto_apply              → fire the action immediately
//   always_confirm          → surface a confirmation card; do NOT fire
//   confirm_if_unfamiliar   → if this actor has ≥ N prior successful
//                             invocations of this action with the same
//                             parameter SHAPE, fire; otherwise confirm.
//                             (Default N = 3 — tunable via familiarityThreshold.)
//
// Default when the YAML field is absent: always_confirm. The schema already
// enforces this via zod's .default(), but resolveActionPolicy also handles
// missing fields defensively so callers wiring ad-hoc Ontology objects don't
// accidentally bypass the safer default.
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
