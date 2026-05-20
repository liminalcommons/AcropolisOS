// M2.2 step-4: ai-sdk v6-shaped apply_action tool.
//
// Why a sibling to tool-gating.ts (Mastra-shaped):
//   - /api/chat/route.ts streams via ai-sdk v6's streamText({tools}), which
//     requires the `ai.tool({...})` shape (not Mastra's createTool).
//   - The execute body is identical to tool-gating's: same dispatcher,
//     same policy gate, same ApplyActionResult contract — we share
//     `runApplyActionTool` to keep them in lockstep.
//
// M3.8 #35: bypass_confirmation is NOT exposed in the LLM tool schema.
// The LLM must never be able to set it — only the server-side confirm
// handler sets bypassConfirmation=true after matching a confirmed
// confirmation-request-id from the user's explicit Confirm click.
// Removing the field from the schema is the simplest, strongest fix.

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

// Build the per-actor discriminated-union schema (action+params).
// M3.8 #35: bypass_confirmation is intentionally absent from this schema.
// The LLM must never emit it — bypass is set only by the server-side
// confirm handler after matching an explicit user Confirm click.
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
      // bypass_confirmation intentionally NOT included — see M3.8 #35.
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
      "When a policy gate returns `confirmation_required`, present the requested change in your text reply and let the user click the Confirm button in the UI.",
    ].join(" "),
    inputSchema,
    execute: async (raw) => {
      // M3.8 #35: bypass_confirmation is never read from LLM tool-call args.
      // Only the server-side confirm handler may set bypassConfirmation=true.
      // Even if a prompt-injected LLM somehow injects the field (schema
      // mismatch), we explicitly ignore it here.
      const parsed = raw as {
        action: string;
        params: unknown;
      };
      return runApplyActionTool({
        actor,
        dispatcher,
        action: parsed.action,
        params: parsed.params,
        policy,
        bypassConfirmation: false, // always false here — only set by server confirm handler
      });
    },
  });
}
