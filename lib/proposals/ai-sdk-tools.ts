// ai-sdk-shaped proposal tools backed by `ProposalDraftStore`. This is the SOLE
// proposal-tool surface — the live /api/chat route wires it into
// `streamText({ tools })`. (A parallel Mastra-shaped `tools.ts` was retired; the
// ai-sdk path superseded it as the single source of the propose_* tools.)
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
import { ViewConfigProposal } from "./diff";
import type {
  FunctionProposal,
  IngestProposal,
  SeedProposal,
} from "./diff";
import type { Proposal, ProposalDraftStore } from "./store";
import type { ProposalDiff } from "./diff";
import type { InboxStore } from "../inbox/store";
import {
  validateViewProposalAgainstLiveOntology,
  InvalidViewProposalError,
} from "./validate-view-proposal";

// One-line, agent-readable summary of what a pending proposal introduces, so
// the model can pick the right id to withdraw_proposal without re-deriving the
// diff. Mirrors the dimensions the /graph overlay surfaces (object + link
// types), plus the other diff buckets when present.
function summarizeDiff(diff: ProposalDiff): string {
  const parts: string[] = [];
  const ots = Object.keys(diff.new_object_types);
  if (ots.length) parts.push(`object types: ${ots.join(", ")}`);
  const lts = Object.keys(diff.new_link_types);
  if (lts.length) parts.push(`link types: ${lts.join(", ")}`);
  const props = [
    ...Object.keys(diff.new_shared_properties),
    ...Object.keys(diff.modified_properties),
  ];
  if (props.length) parts.push(`properties: ${props.join(", ")}`);
  const ats = Object.keys(diff.new_action_types);
  if (ats.length) parts.push(`actions: ${ats.join(", ")}`);
  const views = Object.keys(diff.new_view_configs);
  if (views.length) parts.push(`views: ${views.join(", ")}`);
  const seeds = Object.keys(diff.new_seeds);
  if (seeds.length) parts.push(`seeds: ${seeds.join(", ")}`);
  const ingests = Object.keys(diff.new_ingests);
  if (ingests.length) parts.push(`ingests: ${ingests.join(", ")}`);
  return parts.length ? parts.join("; ") : "(empty proposal)";
}

export function buildAiSdkProposalTools(
  store: ProposalDraftStore,
  session_id: string,
  inboxStore?: InboxStore,
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
        "Stage a governed view CONFIG (not TSX): a scope plus a list of widget descriptors. scope is org|role|viewer (org requires empty scope_key); each descriptor is {id, kind, config, title?} where kind is metric|data_table|roster|calendar. render() consumes the config — you never hand-code markup.",
      inputSchema: ViewConfigProposal,
      execute: async (proposal: ViewConfigProposal) => {
        // Fence (C4): reject a descriptor whose config references a non-existent
        // type/field LOUDLY here, before it reaches the steward queue — instead
        // of approving + persisting it then silently no-op'ing at render.
        // Validates against the live ontology overlaid with object types
        // proposed earlier in THIS draft.
        const currentDraft = await store.getDraft(session_id);
        const validation = await validateViewProposalAgainstLiveOntology(
          proposal,
          currentDraft,
        );
        if (!validation.ok) {
          throw new InvalidViewProposalError(
            validation.error,
            validation.detail,
          );
        }
        const draft = await store.appendView(session_id, proposal);
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

    list_pending_proposals: tool({
      description:
        "List the PENDING proposals currently awaiting steward review, each with its id and a one-line summary of the object/link/property/action/view/seed/ingest types it introduces. Use this to FIND the id of a proposal you finalized earlier (when it is no longer in recent context) before calling withdraw_proposal.",
      inputSchema: z.object({}),
      execute: async () => {
        const all = await store.listProposals();
        const proposals = all
          .filter((p: Proposal) => p.status === "pending")
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map((p) => ({
            id: p.id,
            session_id: p.session_id,
            created_at: p.created_at,
            summary: summarizeDiff(p.diff),
          }));
        return { proposals };
      },
    }),

    withdraw_proposal: tool({
      description:
        "Retract a PENDING proposal you previously finalized, by id. This DELETES the pending row so it disappears from the steward review queue and the /graph growth overlay — use it to CORRECT/UNDO/REPLACE a proposal instead of stacking a duplicate. After withdrawing the stale one, re-stage the corrected version with propose_* + finalize_proposal. Returns { ok, removed } — removed:false means no pending proposal matched that id (already approved, rejected, or unknown). Call list_pending_proposals first if you do not have the id.",
      inputSchema: z.object({
        proposal_id: z
          .string()
          .min(1)
          .describe("The id of the pending proposal to retract."),
      }),
      execute: async ({ proposal_id }) => {
        const removed = await store.withdraw(proposal_id);
        return { ok: true, removed };
      },
    }),

    sample_inbox: tool({
      description:
        "Read a sample of unclaimed inbox rows so you can inspect their payload shape and decide which object type they belong to. Returns up to `limit` rows ordered most-recent first. Use this BEFORE calling propose_ingest to understand the field names in the payload.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe("How many rows to return (default 10, max 50)"),
      }),
      execute: async ({ limit }: { limit?: number } = {}) => {
        if (!inboxStore) {
          return { rows: [], note: "inbox store not available in this context" };
        }
        const rows = await inboxStore.list({
          unclaimedOnly: true,
          limit: limit ?? 10,
        });
        return {
          rows: rows.map((r) => ({
            id: r.id,
            source_filename: r.source_filename,
            payload: r.payload,
          })),
          count: rows.length,
        };
      },
    }),
  };
}
