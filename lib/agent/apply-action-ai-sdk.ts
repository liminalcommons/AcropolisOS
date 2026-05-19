// M2.2 step-4: ai-sdk v6-shaped apply_action tool.
//
// Why a sibling to tool-gating.ts (Mastra-shaped):
//   - /api/chat/route.ts streams via ai-sdk v6's streamText({tools}), which
//     requires the `ai.tool({...})` shape (not Mastra's createTool).
//   - The execute body is identical to tool-gating's: same dispatcher,
//     same policy gate, same ApplyActionResult contract — we share
//     `runApplyActionTool` to keep them in lockstep.
//
// Bypass semantics: the model can include `bypass_confirmation: true` on
// re-fire after the chat panel's Confirm button. The schema permits the
// field; runApplyActionTool skips the policy gate when it's set. Audit row
// metadata still captures the action + actor, so bypass is fully traceable.

import { tool, type Tool } from "ai";
import { z, type ZodTypeAny } from "zod";
import { pascalCase } from "../codegen/zod";
import { buildZodSchemas } from "../codegen/zod";
import type { Actor } from "../ctx";
import type { OntologyCtx } from "../ontology/ctx";
import type { Ontology } from "../ontology/schema";
import {
  canActorInvokeAction,
  runApplyActionTool,
  type ApplyActionDispatcher,
  type ApplyActionPolicyGate,
} from "./tool-gating";

export interface BuildApplyActionAiSdkToolInput {
  actor: Actor | null;
  ontology: Ontology;
  ctx: OntologyCtx;
  dispatcher: ApplyActionDispatcher;
}

// Build the per-actor discriminated-union schema (action+params), then add an
// optional bypass_confirmation flag. ai-sdk v6 prefers a plain object input
// schema, so we wrap the union via z.intersection-with-extension.
function buildApplyActionInputSchema(
  ontology: Ontology,
  allowedActions: string[],
): ZodTypeAny {
  if (allowedActions.length === 0) return z.never();
  const { actionParamSchemas } = buildZodSchemas(ontology);
  const branches = allowedActions.map((name) => {
    const paramSchema = actionParamSchemas[`${pascalCase(name)}Params`];
    if (!paramSchema) {
      throw new Error(`missing param schema for action ${name}`);
    }
    return z.object({
      action: z.literal(name),
      params: paramSchema,
      bypass_confirmation: z.boolean().optional(),
    });
  });
  if (branches.length === 1) return branches[0];
  return z.discriminatedUnion(
    "action",
    branches as [(typeof branches)[number], ...typeof branches],
  );
}

export function buildApplyActionAiSdkTool(
  input: BuildApplyActionAiSdkToolInput,
): Tool {
  const { actor, ontology, ctx, dispatcher } = input;
  const allowedActions = Object.keys(ontology.action_types).filter((name) =>
    canActorInvokeAction(actor, ontology, name),
  );
  const inputSchema = buildApplyActionInputSchema(ontology, allowedActions);
  const policy: ApplyActionPolicyGate = { ontology, ctx };

  return tool({
    description: [
      "Apply a named ontology action to mutate live state (members, events, attendance, etc.).",
      "Use this for committed changes, NOT proposals. Schema-changing work (new types/properties) still goes through propose_* + finalize_proposal.",
      "Action types the current actor is permitted to invoke are surfaced as discriminated branches.",
      "When a policy gate returns `confirmation_required`, the chat UI shows a Confirm button — only call again with `bypass_confirmation: true` after explicit user approval.",
    ].join(" "),
    inputSchema,
    execute: async (raw) => {
      const parsed = raw as {
        action: string;
        params: unknown;
        bypass_confirmation?: boolean;
      };
      return runApplyActionTool({
        actor,
        dispatcher,
        action: parsed.action,
        params: parsed.params,
        policy,
        bypassConfirmation: parsed.bypass_confirmation === true,
      });
    },
  });
}
