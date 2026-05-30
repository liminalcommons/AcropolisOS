// M2.x: ai-sdk v6-shaped READ tools.
//
// `buildReadToolsForActor` produces Mastra-shaped tools (createTool) — same
// reason we have apply-action-ai-sdk.ts as a sibling to tool-gating.ts:
// /api/chat streams via ai-sdk v6 `streamText({tools})` which requires the
// `ai.tool({...})` shape, not Mastra's.
//
// Scope: we surface the five FENCED agent-useful READ operations:
//   - query_<type>   : list with WHERE/limit ("what members do we have")
//   - read_<type>    : get-by-id
//   - describe_<type>: show the schema (helps the agent understand fields)
//   - traverse_<type>: follow links to related rows
//   - sample_<type>  : pull representative rows to inspect real values
//
// traverse/sample are surfaced (slice-3) so the agent can GROUND its
// view/ontology proposals in real rows — citing traversal/sample evidence
// in proposals (§6.3 evidence-gated grounding) rather than guessing at shape.
// These all route through the wrapped `ctx.objects` permission fence.
//
// `audit_<type>` is DELIBERATELY EXCLUDED: the audit op (read-tools.ts) returns
// before/after row snapshots filtered ONLY by subject_type — NOT by the actor's
// read tokens — so it is an UNFENCED read surface. Surfacing it would let a
// non-steward AI actor read snapshots of rows/fields it cannot otherwise read.
// traverse/sample already provide fenced evidence-grounding; audit is not needed.

import { tool, type Tool } from "ai";
import type { ZodTypeAny } from "zod";
import type { AnyMastraTool } from "../codegen/mastra-tools";
import type { Ontology } from "../ontology/schema";
import type { OntologyCtx } from "../ontology/ctx";
import { buildReadToolsForActor } from "./read-tools";

const AGENT_READ_OPS = ["query", "read", "describe", "traverse", "sample"] as const;

export interface BuildReadToolsAiSdkInput {
  ontology: Ontology;
  ctx: OntologyCtx;
}

export function buildReadToolsAiSdk(
  input: BuildReadToolsAiSdkInput,
): Record<string, Tool> {
  const mastraTools = buildReadToolsForActor(input);
  const out: Record<string, Tool> = {};

  for (const [id, mastraTool] of Object.entries(mastraTools)) {
    // Only surface the agent-useful subset.
    if (!AGENT_READ_OPS.some((op) => id.startsWith(`${op}_`))) continue;
    out[id] = wrapMastraReadTool(mastraTool);
  }

  return out;
}

function wrapMastraReadTool(mastraTool: AnyMastraTool): Tool {
  // Mastra execute receives ({context}, runtimeCtx). ai-sdk v6 execute receives
  // (input, options). The input shape (validated by Zod) is identical.
  const exec = mastraTool.execute;
  if (!exec) {
    throw new Error(`mastra tool ${mastraTool.id} has no execute`);
  }
  return tool({
    description: mastraTool.description ?? "",
    inputSchema: mastraTool.inputSchema as ZodTypeAny,
    execute: async (rawInput: unknown) => {
      // The Mastra READ-tool executes in lib/agent/read-tools.ts read the input
      // directly (not from {context}), so we forward `rawInput` straight
      // through and pass an empty second arg.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (exec as any)(rawInput, {});
    },
  });
}
