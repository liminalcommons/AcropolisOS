import { describe, expect, it } from "vitest";
import {
  InMemoryProposalDraftStore,
  ProposalDraftNotFoundError,
} from "./store";
import type { InlineProperty, LinkType, ObjectType } from "../ontology/schema";

const SAMPLE_OT: ObjectType = {
  description: "A discussion forum thread",
  properties: {
    id: { type: "uuid", primary_key: true },
    title: { type: "string", required: true },
  },
};

const SAMPLE_LT: LinkType = {
  from: "Member",
  to: "Thread",
  cardinality: "one-to-many",
};

const SAMPLE_PROP: InlineProperty = {
  type: "string",
  description: "A user-facing tag",
};

describe("InMemoryProposalDraftStore", () => {
  it("getDraft returns null for an unknown session", async () => {
    const store = new InMemoryProposalDraftStore();
    expect(await store.getDraft("nope")).toBeNull();
  });

  it("appendObjectType writes the object type and updates impacted_tables", async () => {
    const store = new InMemoryProposalDraftStore();
    const draft = await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    expect(draft.new_object_types["Thread"]).toEqual(SAMPLE_OT);
    expect(draft.impacted_tables).toContain("Thread");
  });

  it("appendLinkType writes the link type without touching object_types", async () => {
    const store = new InMemoryProposalDraftStore();
    const draft = await store.appendLinkType("s1", "member_threads", SAMPLE_LT);
    expect(draft.new_link_types["member_threads"]).toEqual(SAMPLE_LT);
    expect(draft.new_object_types).toEqual({});
  });

  it("appendSharedProperty routes to new_shared_properties by default", async () => {
    const store = new InMemoryProposalDraftStore();
    const draft = await store.appendSharedProperty("s1", "tag", SAMPLE_PROP);
    expect(draft.new_shared_properties["tag"]).toEqual(SAMPLE_PROP);
    expect(draft.modified_properties).toEqual({});
  });

  it("appendSharedProperty routes to modified_properties when modifying=true", async () => {
    const store = new InMemoryProposalDraftStore();
    const draft = await store.appendSharedProperty("s1", "email", SAMPLE_PROP, {
      modifying: true,
    });
    expect(draft.modified_properties["email"]).toEqual(SAMPLE_PROP);
    expect(draft.new_shared_properties).toEqual({});
  });

  it("accumulates changes within a single session id", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    await store.appendLinkType("s1", "member_threads", SAMPLE_LT);
    await store.appendSharedProperty("s1", "tag", SAMPLE_PROP);
    const draft = await store.getDraft("s1");
    expect(draft).not.toBeNull();
    expect(Object.keys(draft!.new_object_types)).toEqual(["Thread"]);
    expect(Object.keys(draft!.new_link_types)).toEqual(["member_threads"]);
    expect(Object.keys(draft!.new_shared_properties)).toEqual(["tag"]);
  });

  it("isolates drafts across sessions", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    await store.appendObjectType("s2", "Post", SAMPLE_OT);
    const s1 = await store.getDraft("s1");
    const s2 = await store.getDraft("s2");
    expect(Object.keys(s1!.new_object_types)).toEqual(["Thread"]);
    expect(Object.keys(s2!.new_object_types)).toEqual(["Post"]);
  });

  it("finalize creates a pending proposal and clears the draft", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    const proposal = await store.finalize("s1");
    expect(proposal.status).toBe("pending");
    expect(proposal.session_id).toBe("s1");
    expect(proposal.id).toMatch(/[0-9a-f-]{36}/i);
    expect(proposal.diff.new_object_types["Thread"]).toEqual(SAMPLE_OT);
    expect(await store.getDraft("s1")).toBeNull();
  });

  it("finalize throws ProposalDraftNotFoundError for unknown session", async () => {
    const store = new InMemoryProposalDraftStore();
    await expect(store.finalize("ghost")).rejects.toBeInstanceOf(
      ProposalDraftNotFoundError,
    );
  });

  it("finalize snapshots the draft (later draft writes do not mutate prior proposals)", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    const proposal = await store.finalize("s1");
    await store.appendObjectType("s1", "Post", SAMPLE_OT);
    expect(Object.keys(proposal.diff.new_object_types)).toEqual(["Thread"]);
  });

  it("listProposals returns finalized proposals in insertion order", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "A", SAMPLE_OT);
    const p1 = await store.finalize("s1");
    await store.appendObjectType("s2", "B", SAMPLE_OT);
    const p2 = await store.finalize("s2");
    const all = await store.listProposals();
    expect(all.map((p) => p.id)).toEqual([p1.id, p2.id]);
  });
});
