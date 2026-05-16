// US-033: Session-start tool gating.
//
// At session start we filter the global Mastra tool list down to the subset
// the actor can plausibly invoke, then rebuild apply_action's discriminated
// union so its branches only cover action_types the actor's role can call.
// The LLM never sees forbidden tools or actions — the schema is the wall.
//
// PROPOSE tools (lib/proposals/tools.ts) are intentionally NOT filtered here
// — proposals queue for non-stewards and so must remain visible to everyone.
// Callers that wish to expose them should merge them in after gating.

import { z, type ZodTypeAny } from "zod";
import { createTool } from "@mastra/core/tools";
import { ActionPermissionError } from "../actions/permission-check";
import type { Actor } from "../ctx";
import type { Ontology } from "../ontology/schema";
import type { OntologyCtx } from "../ontology/ctx";
import {
  READ_OPS,
  buildMastraTools,
  toolIdFor,
  type AnyMastraTool,
} from "../codegen/mastra-tools";
import { buildZodSchemas, pascalCase } from "../codegen/zod";
import { buildReadToolsForActor } from "./read-tools";

// US-032: apply_action's execute() dispatches to whatever runs the action
// (in production: an Inngest send + wait; in tests: a direct middleware
// call). The dispatcher returns whatever the action returned, and may throw
// ActionPermissionError — apply_action catches that and turns it into a
// structured chat-visible error rather than letting the throw bubble up.
export type ApplyActionDispatcher = (input: {
  action: string;
  params: unknown;
}) => Promise<unknown>;

export interface GetToolsForActorOptions {
  applyActionDispatcher?: ApplyActionDispatcher;
  // When supplied, READ tools (describe/query/traverse/sample/read/audit) are
  // wired with real executes that route through this ctx. Without it, READ
  // tools surface their codegen stubs that throw "not implemented (US-014)".
  ctx?: OntologyCtx;
}

export interface ApplyActionResult {
  ok: boolean;
  result?: unknown;
  error?: {
    type: "permission_denied" | "not_implemented" | "internal";
    action: string;
    actor_id: string | null;
    required_permissions: string[];
    message: string;
  };
}

// Execute logic extracted from the Mastra tool wrapper so it is directly
// testable without going through the wrapper's input validation pipeline.
// Production call path is identical: the tool's execute() forwards to this.
export async function runApplyActionTool(input: {
  actor: Actor | null;
  dispatcher: ApplyActionDispatcher | undefined;
  action: string;
  params: unknown;
}): Promise<ApplyActionResult> {
  if (!input.dispatcher) {
    return {
      ok: false,
      error: {
        type: "not_implemented",
        action: input.action,
        actor_id: input.actor?.userId ?? null,
        required_permissions: [],
        message:
          "apply_action dispatcher is not wired (handler arrives with US-027)",
      },
    };
  }
  try {
    const result = await input.dispatcher({
      action: input.action,
      params: input.params,
    });
    return { ok: true, result };
  } catch (err) {
    if (err instanceof ActionPermissionError) {
      return {
        ok: false,
        error: {
          type: "permission_denied",
          action: err.actionName,
          actor_id: err.actorId,
          required_permissions: err.requiredPermissions,
          message: err.message,
        },
      };
    }
    throw err;
  }
}

export interface ToolsForActor {
  tools: Record<string, AnyMastraTool>;
  applyActionInput: ZodTypeAny;
  allowedActions: string[];
}

// Session-start matching: no row context yet, so `member_self` is allowed
// because the actor may own some target row at call time. Row-level checks
// still run in ctx (US-031) when the tool actually executes.
function actorMatchesTokens(
  actor: Actor | null,
  tokens: string[] | undefined,
): boolean {
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

export function canActorReadObjectType(
  actor: Actor | null,
  ontology: Ontology,
  objectTypeName: string,
): boolean {
  const def = ontology.object_types[objectTypeName];
  if (!def) return false;
  return actorMatchesTokens(actor, def.permissions?.read);
}

export function canActorInvokeAction(
  actor: Actor | null,
  ontology: Ontology,
  actionName: string,
): boolean {
  const def = ontology.action_types[actionName];
  if (!def) return false;
  return actorMatchesTokens(actor, def.permissions);
}

export function getToolsForActor(
  ontology: Ontology,
  actor: Actor | null,
  options: GetToolsForActorOptions = {},
): ToolsForActor {
  const { tools: allTools } = buildMastraTools(ontology);
  // When ctx is supplied, prefer the real-execute READ tools from
  // `buildReadToolsForActor` over the codegen stubs in `buildMastraTools`.
  const readToolsWithCtx = options.ctx
    ? buildReadToolsForActor({ ontology, ctx: options.ctx })
    : null;
  const filtered: Record<string, AnyMastraTool> = {};

  // READ tools: keep only object types the actor can read.
  for (const objName of Object.keys(ontology.object_types)) {
    if (!canActorReadObjectType(actor, ontology, objName)) continue;
    const pascal = pascalCase(objName);
    for (const op of READ_OPS) {
      const id = toolIdFor(op, pascal);
      const tool = readToolsWithCtx?.[id] ?? allTools[id];
      if (tool) filtered[id] = tool;
    }
  }

  // apply_action: narrow the discriminated union to allowed action types.
  const allowedActions = Object.keys(ontology.action_types).filter((name) =>
    canActorInvokeAction(actor, ontology, name),
  );

  let applyActionInput: ZodTypeAny;
  if (allowedActions.length === 0) {
    applyActionInput = z.never();
  } else {
    const { actionParamSchemas } = buildZodSchemas(ontology);
    const branches = allowedActions.map((name) => {
      const paramSchema = actionParamSchemas[`${pascalCase(name)}Params`];
      if (!paramSchema) {
        throw new Error(`missing param schema for action ${name}`);
      }
      return z.object({
        action: z.literal(name),
        params: paramSchema,
      });
    });
    applyActionInput =
      branches.length === 1
        ? branches[0]
        : z.discriminatedUnion(
            "action",
            branches as [
              (typeof branches)[number],
              ...typeof branches,
            ],
          );

    const dispatcher = options.applyActionDispatcher;
    filtered.apply_action = createTool({
      id: "apply_action",
      description:
        "Apply a named action to mutate ontology state. Input is a discriminated union over the action types the current actor is permitted to invoke.",
      inputSchema: applyActionInput,
      outputSchema: z.object({
        ok: z.boolean(),
        result: z.unknown().optional(),
        error: z
          .object({
            type: z.enum(["permission_denied", "not_implemented", "internal"]),
            action: z.string(),
            actor_id: z.string().nullable(),
            required_permissions: z.array(z.string()),
            message: z.string(),
          })
          .optional(),
      }),
      execute: async (inputData) => {
        const input = inputData as { action: string; params: unknown };
        return runApplyActionTool({
          actor,
          dispatcher,
          action: input.action,
          params: input.params,
        });
      },
    });
  }

  return { tools: filtered, applyActionInput, allowedActions };
}
