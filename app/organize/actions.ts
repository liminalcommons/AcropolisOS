"use server";

// A4 (extends A3): Server actions for the organize (assimilation) flow.
//
// confirmProposal is the steward-gated, zod-validated server action that
// the ProposalReviewList Confirm button calls.
//
// A4 extension: accepts an optional `resolution` argument forwarded from the UI:
//   - absent (default): dedup runs; may return { status: "duplicate_candidate" }
//   - "create_new": skip dedup, run A3 create
//   - { merge_into: "<id>" }: stamp provenance, no new row
//
// Security boundaries (all enforced inside commitProposalCore):
//   - Steward gate: actor.role !== "steward" → { status: "forbidden" }
//   - Zod validation: proposal shape checked against CommitProposalInputSchema
//   - field_map re-validation: validateFieldMap called server-side (never
//     trusts the client's prior validation from the A1 classify response)
//   - Idempotent: transactional classified_as IS NULL guard prevents double-write

import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import {
  commitProposalCore,
  type CommitProposalInput,
  type CommitProposalResult,
  type Resolution,
} from "@/lib/organize/commit";

export async function confirmProposal(
  proposal: CommitProposalInput,
  resolution?: Resolution,
): Promise<CommitProposalResult> {
  // Resolve actor from session — buildChatRuntime handles auth internally.
  const chatRuntime = await buildChatRuntime();

  // Anonymous actors get a clean 403 path (isAnonymous checks role==="anonymous")
  if (isAnonymous(chatRuntime.actor)) {
    return { status: "forbidden" };
  }

  const db = getDb();
  return commitProposalCore(
    db,
    chatRuntime.actor.role,
    chatRuntime.actor.userId,
    proposal,
    resolution,
  );
}
