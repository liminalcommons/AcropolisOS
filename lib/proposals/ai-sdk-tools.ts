// ai-sdk-shaped proposal tools backed by the same `ProposalDraftStore` as
// `tools.ts`. The Mastra-shaped tools in `tools.ts` are kept for unit-test
// parity and future Agent-API usage; this module is what the live /api/chat
// route wires into `streamText({ tools })`.
//
// session_id is closed over at construction time so the model only sees the
// content-bearing parameters. The route extracts session_id from the request
// body (UI generates a stable id per browser session) and rebuilds the tools
// per request.

import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  ActionType,
  InlineProperty,
  LinkType,
  ObjectType,
} from "../ontology/schema";
import type {
  FunctionProposal,
  IngestProposal,
  SeedProposal,
  ViewProposal,
} from "./diff";
import type { ProposalDraftStore } from "./store";

export function buildAiSdkProposalTools(
  store: ProposalDraftStore,
  session_id: string,
): Record<string, Tool> {
  return {
    propose_object_type: tool({
      description:
        "Add a new object type to the chat-session ontology proposal draft. Does not mutate the live ontology.",
      inputSchema: z.object({
        name: z.string().min(1),
        definition: ObjectType,
      }),
      execute: async ({ name, definition }) => {
        const draft = await store.appendObjectType(session_id, name, definition);
        return { ok: true, draft };
      },
    }),

    propose_link_type: tool({
      description:
        "Add a new link type to the chat-session ontology proposal draft. Does not mutate the live ontology.",
      inputSchema: z.object({
        name: z.string().min(1),
        definition: LinkType,
      }),
      execute: async ({ name, definition }) => {
        const draft = await store.appendLinkType(session_id, name, definition);
        return { ok: true, draft };
      },
    }),

    propose_shared_property: tool({
      description:
        "Add (or modify) a shared property in the chat-session proposal draft. Set modifying=true to record a change to an existing shared property.",
      inputSchema: z.object({
        name: z.string().min(1),
        definition: InlineProperty,
        modifying: z.boolean().optional(),
      }),
      execute: async ({ name, definition, modifying }) => {
        const draft = await store.appendSharedProperty(
          session_id,
          name,
          definition,
          { modifying: modifying ?? false },
        );
        return { ok: true, draft };
      },
    }),

    propose_action_type: tool({
      description:
        "Add a new action type (typed mutation) to the chat-session proposal draft. Not yet executed.",
      inputSchema: z.object({
        name: z.string().min(1),
        definition: ActionType,
      }),
      execute: async ({ name, definition }) => {
        const draft = await store.appendActionType(
          session_id,
          name,
          ActionType.parse(definition),
        );
        return { ok: true, draft };
      },
    }),

    propose_function: tool({
      description:
        "Stage a TypeScript function file for the proposal. Body is stored verbatim; not compiled.",
      inputSchema: z.object({
        filename: z.string().min(1),
        ts_body: z.string(),
      }),
      execute: async ({ filename, ts_body }) => {
        const draft = await store.appendFunction(session_id, {
          filename,
          ts_body,
        } satisfies FunctionProposal);
        return { ok: true, draft };
      },
    }),

    propose_view: tool({
      description:
        "Stage a custom TSX view for an object type (list, detail, form). Body is stored verbatim; not compiled.",
      inputSchema: z.object({
        object_type: z.string().min(1),
        view: z.string().min(1),
        tsx_body: z.string(),
      }),
      execute: async ({ object_type, view, tsx_body }) => {
        const draft = await store.appendView(session_id, {
          object_type,
          view,
          tsx_body,
        } satisfies ViewProposal);
        return { ok: true, draft };
      },
    }),

    propose_seed: tool({
      description:
        "Stage seed rows for an object type as JSONL. Not yet inserted; proposal carries the literal payload.",
      inputSchema: z.object({
        object_type: z.string().min(1),
        rows_jsonl: z.string(),
      }),
      execute: async ({ object_type, rows_jsonl }) => {
        const draft = await store.appendSeed(session_id, {
          object_type,
          rows_jsonl,
        } satisfies SeedProposal);
        return { ok: true, draft };
      },
    }),

    propose_ingest: tool({
      description:
        "Stage an inbox-ingest mapping from inbox rows into a target object type. Field-name to field-name mapping. Not yet executed.",
      inputSchema: z.object({
        name: z.string().min(1),
        inbox_ids: z.array(z.string().min(1)).min(1),
        target_object_type: z.string().min(1),
        mapping: z.record(z.string(), z.string()),
      }),
      execute: async ({ name, inbox_ids, target_object_type, mapping }) => {
        const draft = await store.appendIngest(session_id, name, {
          inbox_ids,
          target_object_type,
          mapping,
        } satisfies IngestProposal);
        return { ok: true, draft };
      },
    }),

    finalize_proposal: tool({
      description:
        "Freeze the current proposal draft for this chat session and create a pending proposal row. Clears the draft. Call this after staging all propose_* changes the user agreed to.",
      inputSchema: z.object({}),
      execute: async () => {
        const proposal = await store.finalize(session_id);
        return { ok: true, proposal };
      },
    }),
  };
}
