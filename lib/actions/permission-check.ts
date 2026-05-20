// US-032: Permission enforcement in action middleware.
//
// The action layer refuses to invoke a handler when the actor's role is not
// in the action's declared permissions. This is the *action-level* check —
// distinct from US-031's *object-level* read/write filtering inside ctx.
//
// Membership semantics mirror tool-gating (US-033) at session-start: a token
// matches when it equals the actor's role, equals a custom role the actor
// carries, equals "*", or equals "member_self" (allowed here because the
// row-level identity check happens later inside ctx writes — see US-031).
//
// On denial: throws ActionPermissionError (a subclass of PermissionError so
// callers can catch either) and, if ctx.audit is wired, records a rejection
// row in action_audit. Audit writes are best-effort: they MUST NOT mask the
// permission error, and a missing audit store MUST NOT cause a secondary
// throw.

import type { Actor } from "../ctx";
import {
  PermissionError,
  type OntologyCtx,
} from "../ontology/ctx";
import type { Ontology } from "../ontology/schema";
import { recordActionInvocation } from "../audit/writer";

export class ActionPermissionError extends PermissionError {
  readonly actionName: string;
  readonly requiredPermissions: string[];

  constructor(input: {
    actorId: string | null;
    actionName: string;
    requiredPermissions: string[];
  }) {
    super(
      `actor ${input.actorId ?? "<anonymous>"} cannot invoke action "${input.actionName}" (requires one of: ${input.requiredPermissions.length > 0 ? input.requiredPermissions.join(", ") : "<unknown>"})`,
      input.actorId,
      input.actionName,
      "invoke",
    );
    this.name = "ActionPermissionError";
    this.actionName = input.actionName;
    this.requiredPermissions = [...input.requiredPermissions];
  }
}

function actorMatchesActionTokens(
  actor: Actor | null,
  tokens: string[] | undefined,
): boolean {
  // Undeclared permissions => action is open (mirrors object_type behavior).
  if (!tokens || tokens.length === 0) return true;
  if (tokens.includes("*")) return true;
  if (!actor) return false;
  for (const token of tokens) {
    if (token === actor.role) return true;
    if (token === "member_self") return true;
    if (actor.customRoles.includes(token)) return true;
  }
  return false;
}

export function canActorInvokeAction(
  actor: Actor | null,
  ontology: Ontology,
  actionName: string,
): boolean {
  const def = ontology.action_types[actionName];
  if (!def) return false;
  return actorMatchesActionTokens(actor, def.permissions);
}

export interface EnforceActionPermissionInput {
  ontology: Ontology;
  actionName: string;
  ctx: OntologyCtx;
  // M3.8 #34: action parameters are required to resolve member_self
  // ownership at the row level. Optional for callers that pre-date the
  // row-ownership enforcement; absence is treated as "no ref params" so
  // a member_self-only permission with no resolvable target row rejects.
  params?: unknown;
}

// Audit failures must not mask the permission error. We swallow audit-write
// throws here; the PermissionError takes precedence as the user-visible signal.
async function writeRejectionAudit(
  ctx: OntologyCtx,
  actionName: string,
  requiredPermissions: string[],
  reason: "permission_denied" | "unknown_action",
): Promise<void> {
  if (!ctx.audit) return;
  const actor = ctx.actor;
  try {
    await recordActionInvocation(ctx.audit, {
      actor: actor?.userId ?? "<anonymous>",
      actor_role: actor?.role ?? "<anonymous>",
      via: "inngest",
      subject_type: "action",
      subject_id: actionName,
      before: null,
      after: null,
      metadata: {
        result: "rejected",
        reason,
        required_permissions: requiredPermissions,
      },
    });
  } catch {
    // Best-effort: swallow.
  }
}

export async function enforceActionPermission(
  input: EnforceActionPermissionInput,
): Promise<void> {
  const { ontology, actionName, ctx } = input;
  const def = ontology.action_types[actionName];

  if (!def) {
    await writeRejectionAudit(ctx, actionName, [], "unknown_action");
    throw new ActionPermissionError({
      actorId: ctx.actor?.userId ?? null,
      actionName,
      requiredPermissions: [],
    });
  }

  if (actorMatchesActionTokens(ctx.actor, def.permissions)) return;

  const required = def.permissions ?? [];
  await writeRejectionAudit(ctx, actionName, required, "permission_denied");
  throw new ActionPermissionError({
    actorId: ctx.actor?.userId ?? null,
    actionName,
    requiredPermissions: required,
  });
}
