// US-018: Pure state helpers for the inline proposal panel.
//
// Split out from the React component so the diff summarization, action
// selection by role, and "pick the latest proposal in this chat session"
// logic can be exercised by vitest (environment: node) without a DOM.

import type { Proposal } from "@/lib/proposals/store";
import type { ProposalDiff } from "@/lib/proposals/diff";
import type { BuiltInRole } from "@/lib/auth/users";

export const CHAT_SESSION_STORAGE_KEY = "acropolisos:chat-session-id";

export type ProposalAction = "apply" | "edit" | "reject" | "submit-for-review";

export interface ProposalDiffSummary {
  new_object_types: string[];
  new_link_types: string[];
  new_shared_properties: string[];
  modified_properties: string[];
  new_action_types: string[];
  function_count: number;
  view_count: number;
  seed_count: number;
  ingest_count: number;
  impacted_tables: string[];
  // Receipts-before-consent: the raw_inbox refs that justified each grown field,
  // surfaced per "<Type>.<field>" key (sorted) so the consent card can render
  // "proposed because of these N rows you dropped". Empty when no field was grown.
  evidenceByField: Array<{ key: string; rows: string[] }>;
  isEmpty: boolean;
}

export function summarizeProposalDiff(diff: ProposalDiff): ProposalDiffSummary {
  const new_object_types = Object.keys(diff.new_object_types).sort();
  const new_link_types = Object.keys(diff.new_link_types).sort();
  const new_shared_properties = Object.keys(diff.new_shared_properties).sort();
  const modified_properties = Object.keys(diff.modified_properties).sort();
  const new_action_types = Object.keys(diff.new_action_types).sort();
  const function_count = Object.keys(diff.new_functions).length;
  const view_count = Object.keys(diff.new_view_configs).length;
  const seed_count = Object.keys(diff.new_seeds).length;
  const ingest_count = Object.keys(diff.new_ingests).length;
  const impacted_tables = [...diff.impacted_tables].sort();
  const evidenceByField = Object.keys(diff.evidence)
    .sort()
    .map((key) => ({ key, rows: diff.evidence[key] }));
  const isEmpty =
    new_object_types.length === 0 &&
    new_link_types.length === 0 &&
    new_shared_properties.length === 0 &&
    modified_properties.length === 0 &&
    new_action_types.length === 0 &&
    function_count === 0 &&
    view_count === 0 &&
    seed_count === 0 &&
    ingest_count === 0 &&
    impacted_tables.length === 0;
  return {
    new_object_types,
    new_link_types,
    new_shared_properties,
    modified_properties,
    new_action_types,
    function_count,
    view_count,
    seed_count,
    ingest_count,
    impacted_tables,
    evidenceByField,
    isEmpty,
  };
}

export function proposalAvailableActions(
  role: BuiltInRole | null,
): ProposalAction[] {
  if (role === "steward") return ["apply", "edit", "reject"];
  if (role === "member") return ["submit-for-review"];
  return [];
}

type ProposalSummary = Pick<
  Proposal,
  "id" | "session_id" | "status" | "created_at"
>;

export function pickLatestProposalForSession<T extends ProposalSummary>(
  proposals: readonly T[],
  session_id: string,
): T | null {
  let latest: T | null = null;
  for (const p of proposals) {
    if (p.session_id !== session_id) continue;
    if (p.status !== "pending") continue;
    if (!latest || p.created_at > latest.created_at) latest = p;
  }
  return latest;
}
