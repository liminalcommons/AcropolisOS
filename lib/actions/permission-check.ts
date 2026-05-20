// US-032: Permission enforcement in action middleware.
//
// The action layer refuses to invoke a handler when the actor's role is not
// in the action's declared permissions. This is the *action-level* check —
// distinct from US-031's *object-level* read/write filtering inside ctx.
//
// Membership semantics mirror tool-gating (US-033) at session-start: a token
// matches when it equals the actor's role, equals a custom role the actor
// carries, equals "*", or — for `member_self` — when the action's ref
// parameter resolves to a row whose owner field equals actor.userId. Steward
// always bypasses the row-ownership leg (M3.8 #34).
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
import type { ActionType, Ontology, PropertyDefinition } from "../ontology/schema";
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

// Synchronous variant — used by canActorInvokeAction. Cannot resolve
// `member_self` because that requires fetching the target row. Treats
// `member_self` as never-matching here; callers that need real authorization
// MUST use the async enforceActionPermission path with params + ctx.
function actorMatchesActionTokensSync(
  actor: Actor | null,
  tokens: string[] | undefined,
): boolean {
  // Undeclared permissions => action is open (mirrors object_type behavior).
  if (!tokens || tokens.length === 0) return true;
  if (tokens.includes("*")) return true;
  if (!actor) return false;
  for (const token of tokens) {
    if (token === actor.role) return true;
    if (actor.customRoles.includes(token)) return true;
    // `member_self` deliberately NOT matched here — needs runtime row check.
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
  return actorMatchesActionTokensSync(actor, def.permissions);
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

// M3.8 #34: a property definition may be the inline form (with `type: 'ref'`
// and `target`) or a `{ ref: <shared-prop> }` reference into the registry.
// We only handle the inline form here — shared ref params would need
// resolution against `ontology.properties[ref]`, which we defer until a
// concrete action exercises that shape.
function isInlineRefParam(
  def: PropertyDefinition,
): def is { type: "ref"; target: string; required?: boolean } {
  return (
    typeof def === "object" &&
    def !== null &&
    "type" in def &&
    (def as { type: string }).type === "ref" &&
    typeof (def as { target?: unknown }).target === "string"
  );
}

// Owner-field probe matching the convention in ontology/ctx.ts:rowOwnedBy.
// Notification rows use recipient_member_id; other types fall back to
// member_id / owner_member_id / owner_id / user_id / userId.
function rowOwnerMatches(
  row: Record<string, unknown>,
  actor: Actor,
): boolean {
  if (row.recipient_member_id === actor.userId) return true;
  if (row.member_id === actor.userId) return true;
  if (row.owner_member_id === actor.userId) return true;
  if (row.owner_id === actor.userId) return true;
  if (row.user_id === actor.userId) return true;
  if (row.userId === actor.userId) return true;
  return false;
}

// Resolve a single ref-target row. The OntologyCtx exposes Member/Event/
// MeetingMinute via `ctx.objects[...]`. Notification rows live in
// `ctx.notifications` (a parallel store with its own findById). Returns
// null when the store is missing OR the row is not found — both cases are
// "cannot verify ownership" and the caller MUST treat as denial.
async function fetchRefRow(
  ctx: OntologyCtx,
  target: string,
  id: unknown,
): Promise<Record<string, unknown> | null> {
  if (typeof id !== "string" || id.length === 0) return null;
  if (target === "Notification") {
    if (!ctx.notifications) return null;
    const row = await ctx.notifications.findById(id);
    return row ? (row as unknown as Record<string, unknown>) : null;
  }
  const objects = ctx.objects as unknown as Record<
    string,
    { findById?: (id: string) => Promise<unknown> } | undefined
  >;
  const access = objects[target];
  if (!access || typeof access.findById !== "function") return null;
  const row = await access.findById(id);
  return row ? (row as Record<string, unknown>) : null;
}

// M3.8 #34: resolve member_self for an action invocation. Steward role
// bypasses the row-ownership leg. For every inline ref parameter in the
// action definition, fetch the target row and require actor to own it.
// Conservative defaults: no ref params, missing row, missing store, or a
// non-owned row all return false.
async function checkMemberSelf(
  actor: Actor | null,
  actionDef: ActionType,
  params: unknown,
  ctx: OntologyCtx,
): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === "steward") return true;

  const refParams: Array<{ name: string; target: string }> = [];
  for (const [paramName, paramDef] of Object.entries(actionDef.parameters ?? {})) {
    if (isInlineRefParam(paramDef)) {
      refParams.push({ name: paramName, target: paramDef.target });
    }
  }
  if (refParams.length === 0) return false;

  const paramsRecord =
    typeof params === "object" && params !== null
      ? (params as Record<string, unknown>)
      : {};

  for (const { name, target } of refParams) {
    const row = await fetchRefRow(ctx, target, paramsRecord[name]);
    if (!row) return false;
    if (!rowOwnerMatches(row, actor)) return false;
  }
  return true;
}

async function actorMatchesActionTokens(
  actor: Actor | null,
  actionDef: ActionType,
  params: unknown,
  ctx: OntologyCtx,
): Promise<boolean> {
  const tokens = actionDef.permissions;
  // Undeclared permissions => action is open (mirrors object_type behavior).
  if (!tokens || tokens.length === 0) return true;
  if (tokens.includes("*")) return true;
  if (!actor) return false;
  for (const token of tokens) {
    if (token === actor.role) return true;
    if (actor.customRoles.includes(token)) return true;
    if (token === "member_self") {
      if (await checkMemberSelf(actor, actionDef, params, ctx)) return true;
    }
  }
  return false;
}

export async function enforceActionPermission(
  input: EnforceActionPermissionInput,
): Promise<void> {
  const { ontology, actionName, ctx, params } = input;
  const def = ontology.action_types[actionName];

  if (!def) {
    await writeRejectionAudit(ctx, actionName, [], "unknown_action");
    throw new ActionPermissionError({
      actorId: ctx.actor?.userId ?? null,
      actionName,
      requiredPermissions: [],
    });
  }

  if (await actorMatchesActionTokens(ctx.actor, def, params, ctx)) return;

  const required = def.permissions ?? [];
  await writeRejectionAudit(ctx, actionName, required, "permission_denied");
  throw new ActionPermissionError({
    actorId: ctx.actor?.userId ?? null,
    actionName,
    requiredPermissions: required,
  });
}
