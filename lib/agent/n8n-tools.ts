// F2-step2b: n8n agent read tools.
//
// Exposes n8n workflow introspection to the chat agent via ai-sdk v6 tool
// shapes. Fails soft: if N8N_API_KEY is unset/placeholder, the tool returns
// an error message instead of throwing into the stream.
//
// create/activate/run workflow tools are step 2c — not implemented here.

import { z } from "zod";
import { tool } from "ai";
import { listWorkflows, N8nNotConfiguredError } from "@/lib/n8n/client";

/**
 * Build the n8n read tools to register in the agent's tool map.
 * Returns a record with the single `list_workflows` tool for step 2b.
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
  };
}
