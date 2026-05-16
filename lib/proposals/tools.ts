import { z } from "zod";
import { createTool, type Tool } from "@mastra/core/tools";
import { InlineProperty, LinkType, ObjectType } from "../ontology/schema";
import { ProposalDiff, ProposalStatus } from "./diff";
import type { ProposalDraftStore } from "./store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMastraTool = Tool<any, any, any, any, any, string, any>;

const proposalDraftOutput = z.object({
  ok: z.literal(true),
  draft: ProposalDiff,
});

const finalizeOutput = z.object({
  ok: z.literal(true),
  proposal: z.object({
    id: z.string(),
    session_id: z.string(),
    status: ProposalStatus,
    created_at: z.string(),
    diff: ProposalDiff,
  }),
});

export interface ProposalTools {
  propose_object_type: AnyMastraTool;
  propose_link_type: AnyMastraTool;
  propose_shared_property: AnyMastraTool;
  finalize_proposal: AnyMastraTool;
  tools: Record<string, AnyMastraTool>;
}

export function buildProposalTools(store: ProposalDraftStore): ProposalTools {
  const propose_object_type = createTool({
    id: "propose_object_type",
    description:
      "Add a new object type to the per-session ontology proposal draft. Does not mutate the live ontology.",
    inputSchema: z.object({
      session_id: z.string().min(1),
      name: z.string().min(1),
      definition: ObjectType,
    }),
    outputSchema: proposalDraftOutput,
    execute: async (input) => {
      const draft = await store.appendObjectType(
        input.session_id,
        input.name,
        input.definition,
      );
      return { ok: true as const, draft };
    },
  });

  const propose_link_type = createTool({
    id: "propose_link_type",
    description:
      "Add a new link type to the per-session ontology proposal draft. Does not mutate the live ontology.",
    inputSchema: z.object({
      session_id: z.string().min(1),
      name: z.string().min(1),
      definition: LinkType,
    }),
    outputSchema: proposalDraftOutput,
    execute: async (input) => {
      const draft = await store.appendLinkType(
        input.session_id,
        input.name,
        input.definition,
      );
      return { ok: true as const, draft };
    },
  });

  const propose_shared_property = createTool({
    id: "propose_shared_property",
    description:
      "Add a new shared property (or modify an existing one) in the per-session proposal draft. Set `modifying: true` to record a change to an existing shared property.",
    inputSchema: z.object({
      session_id: z.string().min(1),
      name: z.string().min(1),
      definition: InlineProperty,
      modifying: z.boolean().optional(),
    }),
    outputSchema: proposalDraftOutput,
    execute: async (input) => {
      const draft = await store.appendSharedProperty(
        input.session_id,
        input.name,
        input.definition,
        { modifying: input.modifying ?? false },
      );
      return { ok: true as const, draft };
    },
  });

  const finalize_proposal = createTool({
    id: "finalize_proposal",
    description:
      "Freeze the current proposal draft for a session and create a pending proposal row. Clears the draft.",
    inputSchema: z.object({ session_id: z.string().min(1) }),
    outputSchema: finalizeOutput,
    execute: async (input) => {
      const proposal = await store.finalize(input.session_id);
      return { ok: true as const, proposal };
    },
  });

  return {
    propose_object_type,
    propose_link_type,
    propose_shared_property,
    finalize_proposal,
    tools: {
      propose_object_type,
      propose_link_type,
      propose_shared_property,
      finalize_proposal,
    },
  };
}
