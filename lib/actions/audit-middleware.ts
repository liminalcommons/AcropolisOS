// US-030: action_audit middleware.
//
// Wraps every Inngest-driven action invocation with an audit envelope:
//
//   audit_pre  → records a pending row, computes idempotency_key, detects replays
//   <body>     → permission check + declarative/function-backed handler
//   audit_post → records completion (ok or error) with duration + result
//
// Idempotency: keys are derived from (actor_id, action_name, canonical params).
// If a prior invocation with the same key completed successfully, the new
// invocation is recorded as a "replay" and the prior result is returned
// without re-executing side effects. Pending or errored priors do NOT count
// as replayable — they're retries, not duplicates.
//
// Audit writes are best-effort: when ctx.audit is absent, the middleware
// computes the idempotency key and returns "new" with a null pending id so
// the action body still runs. The caller doesn't need to branch on whether
// auditing is wired.

import { createHash } from "node:crypto";
import type { Actor } from "../ctx";
import type { OntologyCtx } from "../ontology/ctx";
import type { AuditStore, AuditRow } from "../audit/writer";

const VIA_INNGEST = "inngest";
const SUBJECT_TYPE_ACTION = "action";

export interface IdempotencyKeyInput {
  actor: Actor | null;
  actionName: string;
  params: unknown;
}

// Canonicalize an arbitrary JSON-ish value so { a: 1, b: 2 } and
// { b: 2, a: 1 } hash to the same key. Arrays preserve order. Non-JSON
// values fall through via JSON.stringify's default coercion.
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

export function computeIdempotencyKey(input: IdempotencyKeyInput): string {
  const payload = {
    actor: input.actor?.userId ?? null,
    action: input.actionName,
    params: canonicalize(input.params),
  };
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

// === audit_pre ===

export interface AuditPreInput {
  ctx: OntologyCtx;
  actionName: string;
  params: unknown;
  parentAuditId?: string;
  via?: string;
}

export type AuditPreResult =
  | {
      kind: "new";
      idempotencyKey: string;
      pendingAuditId: string | null;
    }
  | {
      kind: "replay";
      idempotencyKey: string;
      priorAuditId: string;
      priorResult: unknown;
    };

interface ActionMeta {
  result?: unknown;
  idempotency_key?: unknown;
  [key: string]: unknown;
}

function readMeta(row: AuditRow): ActionMeta {
  return row.metadata as ActionMeta;
}

async function findPriorCompleted(
  store: AuditStore,
  key: string,
): Promise<AuditRow | null> {
  const rows = await store.listActionAudit();
  for (const row of rows) {
    const meta = readMeta(row);
    if (meta.result === "ok" && meta.idempotency_key === key) {
      return row;
    }
  }
  return null;
}

function actorIdOf(actor: Actor | null): string {
  return actor?.userId ?? "<anonymous>";
}

function actorRoleOf(actor: Actor | null): string {
  return actor?.role ?? "<anonymous>";
}

export async function auditPreInvocation(
  input: AuditPreInput,
): Promise<AuditPreResult> {
  const { ctx, actionName, params, parentAuditId } = input;
  const via = input.via ?? VIA_INNGEST;
  const idempotencyKey = computeIdempotencyKey({
    actor: ctx.actor,
    actionName,
    params,
  });

  if (!ctx.audit) {
    return { kind: "new", idempotencyKey, pendingAuditId: null };
  }

  const prior = await findPriorCompleted(ctx.audit, idempotencyKey);
  if (prior) {
    // Record the replay attempt so we have an audit trail of duplicate sends.
    await ctx.audit.insertActionAudit({
      actor: actorIdOf(ctx.actor),
      actor_role: actorRoleOf(ctx.actor),
      via,
      subject_type: SUBJECT_TYPE_ACTION,
      subject_id: actionName,
      before: null,
      after: null,
      metadata: {
        result: "replay",
        idempotency_key: idempotencyKey,
        replay_of_audit_id: prior.id,
        params,
        ...(parentAuditId ? { parent_action_audit_id: parentAuditId } : {}),
      },
    });
    const priorResult = (readMeta(prior).captured_result as unknown) ?? null;
    return {
      kind: "replay",
      idempotencyKey,
      priorAuditId: prior.id,
      priorResult,
    };
  }

  const pending = await ctx.audit.insertActionAudit({
    actor: actorIdOf(ctx.actor),
    actor_role: actorRoleOf(ctx.actor),
    via,
    subject_type: SUBJECT_TYPE_ACTION,
    subject_id: actionName,
    before: null,
    after: null,
    metadata: {
      result: "pending",
      idempotency_key: idempotencyKey,
      params,
      ...(parentAuditId ? { parent_action_audit_id: parentAuditId } : {}),
    },
  });

  return { kind: "new", idempotencyKey, pendingAuditId: pending.id };
}

// === audit_post ===

export type AuditPostStatus = "ok" | "error";

export interface AuditPostInput {
  ctx: OntologyCtx;
  actionName: string;
  params: unknown;
  pendingAuditId: string | null;
  idempotencyKey: string;
  parentAuditId?: string;
  via?: string;
  status: AuditPostStatus;
  durationMs: number;
  result?: unknown;
  error?: unknown;
  before?: unknown;
  after?: unknown;
}

function errorMessageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function auditPostInvocation(
  input: AuditPostInput,
): Promise<void> {
  const {
    ctx,
    actionName,
    params,
    pendingAuditId,
    idempotencyKey,
    parentAuditId,
    status,
    durationMs,
    result,
    error,
    before,
    after,
  } = input;
  const via = input.via ?? VIA_INNGEST;
  if (!ctx.audit) return;

  const metadata: Record<string, unknown> = {
    result: status,
    idempotency_key: idempotencyKey,
    duration_ms: durationMs,
    params,
  };
  if (pendingAuditId !== null) metadata.pending_audit_id = pendingAuditId;
  if (parentAuditId) metadata.parent_action_audit_id = parentAuditId;

  if (status === "ok") {
    // Stash the result inside metadata so replay can return it without
    // re-running. The dedicated `after` column carries the same value for
    // ergonomic JSONB queries.
    metadata.captured_result = result ?? null;
  } else {
    metadata.error_message = errorMessageOf(error);
  }

  await ctx.audit.insertActionAudit({
    actor: actorIdOf(ctx.actor),
    actor_role: actorRoleOf(ctx.actor),
    via,
    subject_type: SUBJECT_TYPE_ACTION,
    subject_id: actionName,
    before: before ?? null,
    after: status === "ok" ? (after ?? result ?? null) : null,
    metadata,
  });
}
