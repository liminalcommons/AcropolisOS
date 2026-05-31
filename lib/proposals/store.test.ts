import { describe, expect, it } from "vitest";
import {
  InMemoryProposalDraftStore,
  ProposalDraftNotFoundError,
  ProposalNotFoundError,
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

  it("finalize() normalizes inline properties to refs when shared property exists", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendSharedProperty("s1", "pronouns", {
      type: "string",
      required: false,
    });
    await store.appendObjectType("s1", "Member", {
      properties: {
        id: { type: "uuid", primary_key: true },
        pronouns: { type: "string" },
      },
    });
    const proposal = await store.finalize("s1");
    expect(
      proposal.diff.new_object_types["Member"].properties["pronouns"],
    ).toEqual({ ref: "pronouns" });
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

  it("appendActionType writes the action type and includes creates_object in impacted_tables", async () => {
    const store = new InMemoryProposalDraftStore();
    const draft = await store.appendActionType("s1", "create_thread", {
      creates_object: "Thread",
      agent_policy: "always_confirm",
    });
    expect(draft.new_action_types["create_thread"]).toBeDefined();
    expect(draft.impacted_tables).toContain("Thread");
  });

  it("appendFunction keys by filename and preserves ts_body", async () => {
    const store = new InMemoryProposalDraftStore();
    const draft = await store.appendFunction("s1", {
      filename: "f.ts",
      ts_body: "export const x = 1;",
    });
    expect(draft.new_functions["f.ts"].ts_body).toBe("export const x = 1;");
  });

  it("appendView stores a config view (scope + descriptors) in the draft", async () => {
    const store = new InMemoryProposalDraftStore();
    const draft = await store.appendView("s1", {
      scope: "role",
      scope_key: "steward",
      descriptors: [
        { id: "v1", kind: "metric", config: { type: "member", agg: "count" } },
      ],
    });
    expect(draft.new_view_configs["role:steward"].descriptors[0].id).toBe("v1");
  });

  it("appendSeed keys by object_type and marks the table as impacted", async () => {
    const store = new InMemoryProposalDraftStore();
    const draft = await store.appendSeed("s1", {
      object_type: "Thread",
      rows_jsonl: '{"id":"1"}',
    });
    expect(draft.new_seeds["Thread"].rows_jsonl).toBe('{"id":"1"}');
    expect(draft.impacted_tables).toContain("Thread");
  });

  it("appendIngest stores config under the given name and marks target as impacted", async () => {
    const store = new InMemoryProposalDraftStore();
    const draft = await store.appendIngest("s1", "email_to_thread", {
      inbox_ids: ["a"],
      target_object_type: "Thread",
      mapping: { subject: "title" },
    });
    expect(draft.new_ingests["email_to_thread"].target_object_type).toBe(
      "Thread",
    );
    expect(draft.impacted_tables).toContain("Thread");
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

  it("getProposal returns the proposal by id", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    const p = await store.finalize("s1");
    const found = await store.getProposal(p.id);
    expect(found?.id).toBe(p.id);
    expect(found?.diff.new_object_types["Thread"]).toEqual(SAMPLE_OT);
  });

  it("getProposal returns null for unknown id", async () => {
    const store = new InMemoryProposalDraftStore();
    expect(await store.getProposal("nope")).toBeNull();
  });

  it("updateProposalDiff replaces the proposal's diff payload", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    const p = await store.finalize("s1");
    const nextDiff = {
      ...p.diff,
      new_object_types: { ...p.diff.new_object_types, Post: SAMPLE_OT },
      impacted_tables: ["Post", "Thread"],
    };
    const updated = await store.updateProposalDiff(p.id, nextDiff);
    expect(Object.keys(updated.diff.new_object_types).sort()).toEqual([
      "Post",
      "Thread",
    ]);
    const fetched = await store.getProposal(p.id);
    expect(fetched?.diff.impacted_tables).toEqual(["Post", "Thread"]);
  });

  it("updateProposalDiff throws ProposalNotFoundError for unknown id", async () => {
    const store = new InMemoryProposalDraftStore();
    await expect(
      store.updateProposalDiff("ghost", {
        new_object_types: {},
        new_link_types: {},
        new_shared_properties: {},
        modified_properties: {},
        new_action_types: {},
        new_functions: {},
        new_view_configs: {},
        new_seeds: {},
        new_ingests: {},
        impacted_tables: [],
      }),
    ).rejects.toBeInstanceOf(ProposalNotFoundError);
  });

  it("setStatus transitions pending proposal to approved", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    const p = await store.finalize("s1");
    const updated = await store.setStatus(p.id, "approved");
    expect(updated.status).toBe("approved");
    const fetched = await store.getProposal(p.id);
    expect(fetched?.status).toBe("approved");
  });

  it("setStatus throws ProposalNotFoundError for unknown id", async () => {
    const store = new InMemoryProposalDraftStore();
    await expect(store.setStatus("ghost", "rejected")).rejects.toBeInstanceOf(
      ProposalNotFoundError,
    );
  });

  it("withdraw removes a pending proposal so it no longer lists", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    const p = await store.finalize("s1");
    expect((await store.listProposals()).map((x) => x.id)).toEqual([p.id]);
    const removed = await store.withdraw(p.id);
    expect(removed).toBe(true);
    expect(await store.listProposals()).toEqual([]);
    expect(await store.getProposal(p.id)).toBeNull();
  });

  it("withdraw returns false for an unknown id", async () => {
    const store = new InMemoryProposalDraftStore();
    expect(await store.withdraw("ghost")).toBe(false);
  });

  it("withdraw refuses a non-pending proposal (returns false, keeps the row)", async () => {
    const store = new InMemoryProposalDraftStore();
    await store.appendObjectType("s1", "Thread", SAMPLE_OT);
    const p = await store.finalize("s1");
    await store.setStatus(p.id, "approved");
    const removed = await store.withdraw(p.id);
    expect(removed).toBe(false);
    expect((await store.getProposal(p.id))?.status).toBe("approved");
  });
});
