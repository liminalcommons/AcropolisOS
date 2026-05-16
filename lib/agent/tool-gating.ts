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
import type { Actor } from "../ctx";
import type { Ontology } from "../ontology/schema";
import {
  READ_OPS,
  buildMastraTools,
  toolIdFor,
  type AnyMastraTool,
} from "../codegen/mastra-tools";
import { buildZodSchemas, pascalCase } from "../codegen/zod";

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
): ToolsForActor {
  const { tools: allTools } = buildMastraTools(ontology);
  const filtered: Record<string, AnyMastraTool> = {};

  // READ tools: keep only object types the actor can read.
  for (const objName of Object.keys(ontology.object_types)) {
    if (!canActorReadObjectType(actor, ontology, objName)) continue;
    const pascal = pascalCase(objName);
    for (const op of READ_OPS) {
      const id = toolIdFor(op, pascal);
      const tool = allTools[id];
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

    filtered.apply_action = createTool({
      id: "apply_action",
      description:
        "Apply a named action to mutate ontology state. Input is a discriminated union over the action types the current actor is permitted to invoke.",
      inputSchema: applyActionInput,
      outputSchema: z.object({
        ok: z.boolean(),
        created: z
          .object({
            object_type: z.string().optional(),
            id: z.string().optional(),
          })
          .optional(),
      }),
      execute: async () => {
        throw new Error("apply_action not implemented (US-027)");
      },
    });
  }

  return { tools: filtered, applyActionInput, allowedActions };
}
