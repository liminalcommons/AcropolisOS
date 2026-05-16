import { z } from "zod";
import { createTool, type Tool } from "@mastra/core/tools";
import {
  ActionType,
  InlineProperty,
  LinkType,
  ObjectType,
} from "../ontology/schema";
import {
  FunctionProposal,
  IngestProposal,
  ProposalDiff,
  ProposalStatus,
  SeedProposal,
  ViewProposal,
} from "./diff";
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
  propose_action_type: AnyMastraTool;
  propose_function: AnyMastraTool;
  propose_view: AnyMastraTool;
  propose_seed: AnyMastraTool;
  propose_ingest: AnyMastraTool;
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

  const propose_action_type = createTool({
    id: "propose_action_type",
    description:
      "Add a new action type to the per-session proposal draft. Action types describe agent-invocable mutations on the ontology; not yet executed.",
    inputSchema: z.object({
      session_id: z.string().min(1),
      name: z.string().min(1),
      definition: ActionType,
    }),
    outputSchema: proposalDraftOutput,
    execute: async (input) => {
      const draft = await store.appendActionType(
        input.session_id,
        input.name,
        ActionType.parse(input.definition),
      );
      return { ok: true as const, draft };
    },
  });

  const propose_function = createTool({
    id: "propose_function",
    description:
      "Stage a TypeScript function file for the proposal. Body is stored verbatim as a string; not compiled or executed.",
    inputSchema: z.object({
      session_id: z.string().min(1),
      filename: z.string().min(1),
      ts_body: z.string(),
    }),
    outputSchema: proposalDraftOutput,
    execute: async (input) => {
      const draft = await store.appendFunction(input.session_id, {
        filename: input.filename,
        ts_body: input.ts_body,
      } satisfies FunctionProposal);
      return { ok: true as const, draft };
    },
  });

  const propose_view = createTool({
    id: "propose_view",
    description:
      "Stage a custom TSX view for an object type (e.g. list, detail, form). Body is stored verbatim; not compiled.",
    inputSchema: z.object({
      session_id: z.string().min(1),
      object_type: z.string().min(1),
      view: z.string().min(1),
      tsx_body: z.string(),
    }),
    outputSchema: proposalDraftOutput,
    execute: async (input) => {
      const draft = await store.appendView(input.session_id, {
        object_type: input.object_type,
        view: input.view,
        tsx_body: input.tsx_body,
      } satisfies ViewProposal);
      return { ok: true as const, draft };
    },
  });

  const propose_seed = createTool({
    id: "propose_seed",
    description:
      "Stage seed rows for an object type as JSONL. Rows are not yet inserted; the proposal carries the literal payload.",
    inputSchema: z.object({
      session_id: z.string().min(1),
      object_type: z.string().min(1),
      rows_jsonl: z.string(),
    }),
    outputSchema: proposalDraftOutput,
    execute: async (input) => {
      const draft = await store.appendSeed(input.session_id, {
        object_type: input.object_type,
        rows_jsonl: input.rows_jsonl,
      } satisfies SeedProposal);
      return { ok: true as const, draft };
    },
  });

  const propose_ingest = createTool({
    id: "propose_ingest",
    description:
      "Stage an inbox-ingest configuration mapping inbox rows into a target object type. Mapping is field-name to field-name; not yet executed.",
    inputSchema: z.object({
      session_id: z.string().min(1),
      name: z.string().min(1),
      inbox_ids: z.array(z.string().min(1)).min(1),
      target_object_type: z.string().min(1),
      mapping: z.record(z.string(), z.string()),
    }),
    outputSchema: proposalDraftOutput,
    execute: async (input) => {
      const draft = await store.appendIngest(input.session_id, input.name, {
        inbox_ids: input.inbox_ids,
        target_object_type: input.target_object_type,
        mapping: input.mapping,
      } satisfies IngestProposal);
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
    propose_action_type,
    propose_function,
    propose_view,
    propose_seed,
    propose_ingest,
    finalize_proposal,
    tools: {
      propose_object_type,
      propose_link_type,
      propose_shared_property,
      propose_action_type,
      propose_function,
      propose_view,
      propose_seed,
      propose_ingest,
      finalize_proposal,
    },
  };
}
