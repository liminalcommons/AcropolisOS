// F2-step2b: n8n agent read tools.
// F2-step2c: create_workflow write tool added.
//
// Exposes n8n workflow introspection and creation to the chat agent via
// ai-sdk v6 tool shapes. Fails soft: if N8N_API_KEY is unset/placeholder,
// tools return an error message instead of throwing into the stream.

import { z } from "zod";
import { tool } from "ai";
import {
  listWorkflows,
  createWorkflow,
  N8nNotConfiguredError,
} from "@/lib/n8n/client";

/**
 * Build the n8n tools (read + write) to register in the agent's tool map.
 *
 * Step 2b: list_workflows
 * Step 2c: create_workflow
 */
export function buildN8nReadTools() {
  return {
    list_workflows: tool({
      description:
        "List the n8n automation workflows currently defined in this instance. " +
        "Use when the user asks what automations exist, what's connected, or " +
        "what workflows are available.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const workflows = await listWorkflows();
          return {
            count: workflows.length,
            workflows: workflows.map((w) => ({
              id: w.id,
              name: w.name,
              active: w.active,
            })),
          };
        } catch (err) {
          if (err instanceof N8nNotConfiguredError) {
            return {
              error:
                "n8n not connected — owner account and API key needed (set N8N_API_KEY in .env)",
            };
          }
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `n8n error: ${msg}` };
        }
      },
    }),

    create_workflow: tool({
      description:
        "Create a new n8n automation workflow as a draft. Use when the user asks to set up an " +
        "automation, connect a data source, or when materializing a chosen action path. " +
        "Returns the workflow id and an editor URL the operator can open to flesh out the draft " +
        "with real action nodes.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .max(120)
          .describe("Display name for the new workflow"),
        purpose: z
          .string()
          .optional()
          .describe(
            "Human-readable description of what the workflow should do (stored in the name if brief)",
          ),
      }),
      execute: async (input) => {
        try {
          // Incorporate purpose into the name when it meaningfully extends it.
          const workflowName =
            input.purpose && !input.name.toLowerCase().includes(input.purpose.toLowerCase().slice(0, 12))
              ? `${input.name} — ${input.purpose}`.slice(0, 120)
              : input.name;

          const result = await createWorkflow({ name: workflowName });
          const n8nBase =
            process.env.N8N_EDITOR_URL ?? "http://localhost:5678";
          return {
            id: result.id,
            name: result.name,
            editor_url: `${n8nBase}/workflow/${result.id}`,
          };
        } catch (err) {
          if (err instanceof N8nNotConfiguredError) {
            return { error: "n8n not connected" };
          }
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `n8n error: ${msg}` };
        }
      },
    }),
  };
}
