// Revisable proposals: the agent-facing withdraw_proposal + list_pending_proposals
// tools. These let the agent correct a finalized proposal it created (retract +
// re-propose) instead of stacking a duplicate the steward must cherry-pick.

import { describe, expect, it } from "vitest";
import { InMemoryProposalDraftStore } from "./store";
import { buildAiSdkProposalTools } from "./ai-sdk-tools";

const SAMPLE_OT = {
  properties: { id: { type: "uuid", primary_key: true } },
} as const;

describe("withdraw_proposal tool", () => {
  it("removes a pending proposal and returns { ok, removed: true }", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    const p = await store.finalize("s1");

    const { withdraw_proposal } = buildAiSdkProposalTools(store, "s1");
    const result = (await withdraw_proposal.execute!(
      { proposal_id: p.id },
      {} as never,
    )) as { ok: boolean; removed: boolean };

    expect(result).toEqual({ ok: true, removed: true });
    expect(await store.getProposal(p.id)).toBeNull();
  });

  it("returns removed: false for an unknown proposal id", async () => {
    const store = new InMemoryProposalDraftStore();
    const { withdraw_proposal } = buildAiSdkProposalTools(store, "s1");
    const result = (await withdraw_proposal.execute!(
      { proposal_id: "ghost" },
      {} as never,
    )) as { ok: boolean; removed: boolean };
    expect(result).toEqual({ ok: true, removed: false });
  });
});

describe("list_pending_proposals tool", () => {
  it("lists pending proposals with id + a one-line summary, excluding non-pending", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    await store.appendLinkType("s1", "member_threads", {
      from: "Member",
      to: "Thread",
      cardinality: "one-to-many",
    });
    const pending = await store.finalize("s1");

    // A second, then approved proposal must NOT appear in the list.
    await store.appendObjectType("s2", "Post", SAMPLE_OT);
    const approved = await store.finalize("s2");
    await store.setStatus(approved.id, "approved");

    const { list_pending_proposals } = buildAiSdkProposalTools(store, "s1");
    const result = (await list_pending_proposals.execute!(
      {},
      {} as never,
    )) as {
      proposals: Array<{ id: string; summary: string }>;
    };

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].id).toBe(pending.id);
    // Summary mentions the object type and link type it introduces.
    expect(result.proposals[0].summary).toContain("Thread");
    expect(result.proposals[0].summary).toContain("member_threads");
  });

  it("returns an empty list when nothing is pending", async () => {
    const store = new InMemoryProposalDraftStore();
    const { list_pending_proposals } = buildAiSdkProposalTools(store, "s1");
    const result = (await list_pending_proposals.execute!(
      {},
      {} as never,
    )) as { proposals: unknown[] };
    expect(result.proposals).toEqual([]);
  });
});
