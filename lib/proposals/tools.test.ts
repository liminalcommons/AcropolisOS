import { describe, expect, it } from "vitest";
import { Tool } from "@mastra/core/tools";
import { InMemoryProposalDraftStore } from "./store";
import { buildProposalTools } from "./tools";

const SESSION = "session-abc";

describe("buildProposalTools — registration", () => {
  it("registers the four required tool ids", () => {
    const store = new InMemoryProposalDraftStore();
    const { tools } = buildProposalTools(store);
    expect(Object.keys(tools).sort()).toEqual([
      "finalize_proposal",
      "propose_link_type",
      "propose_object_type",
      "propose_shared_property",
    ]);
  });

  it("each tool is a Mastra Tool instance", () => {
    const store = new InMemoryProposalDraftStore();
    const { tools } = buildProposalTools(store);
    for (const t of Object.values(tools)) {
      expect(t).toBeInstanceOf(Tool);
    }
  });

  it("tool ids match their map keys", () => {
    const store = new InMemoryProposalDraftStore();
    const { tools } = buildProposalTools(store);
    for (const [key, tool] of Object.entries(tools)) {
      expect(tool.id).toBe(key);
    }
  });
});

describe("propose_object_type tool", () => {
  it("writes the proposed object type to the session draft", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_object_type } = buildProposalTools(store);
    const result = (await propose_object_type.execute!(
      {
        session_id: SESSION,
        name: "Thread",
        definition: {
          properties: { id: { type: "uuid", primary_key: true } },
        },
      },
      {},
    )) as { ok: true; draft: { new_object_types: Record<string, unknown> } };
    expect(result.ok).toBe(true);
    expect(result.draft.new_object_types["Thread"]).toBeDefined();
  });

  it("exposes an input schema for tool consumers to validate against", () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_object_type } = buildProposalTools(store);
    expect(propose_object_type.inputSchema).toBeDefined();
  });
});

describe("propose_link_type tool", () => {
  it("writes the proposed link type to the session draft", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_link_type } = buildProposalTools(store);
    const result = (await propose_link_type.execute!(
      {
        session_id: SESSION,
        name: "thread_posts",
        definition: {
          from: "Thread",
          to: "Post",
          cardinality: "one-to-many",
        },
      },
      {},
    )) as { ok: true; draft: { new_link_types: Record<string, unknown> } };
    expect(result.draft.new_link_types["thread_posts"]).toBeDefined();
  });
});

describe("propose_shared_property tool", () => {
  it("defaults to new_shared_properties when modifying flag is absent", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_shared_property } = buildProposalTools(store);
    const result = (await propose_shared_property.execute!(
      {
        session_id: SESSION,
        name: "tag",
        definition: { type: "string" },
      },
      {},
    )) as {
      ok: true;
      draft: {
        new_shared_properties: Record<string, unknown>;
        modified_properties: Record<string, unknown>;
      };
    };
    expect(result.draft.new_shared_properties["tag"]).toBeDefined();
    expect(result.draft.modified_properties).toEqual({});
  });

  it("routes to modified_properties when modifying=true", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_shared_property } = buildProposalTools(store);
    const result = (await propose_shared_property.execute!(
      {
        session_id: SESSION,
        name: "email",
        definition: { type: "email" },
        modifying: true,
      },
      {},
    )) as {
      ok: true;
      draft: {
        new_shared_properties: Record<string, unknown>;
        modified_properties: Record<string, unknown>;
      };
    };
    expect(result.draft.modified_properties["email"]).toBeDefined();
    expect(result.draft.new_shared_properties).toEqual({});
  });
});

describe("finalize_proposal tool", () => {
  it("creates a pending proposal carrying all draft changes", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_object_type, finalize_proposal } = buildProposalTools(store);
    await propose_object_type.execute!(
      {
        session_id: SESSION,
        name: "Thread",
        definition: {
          properties: { id: { type: "uuid", primary_key: true } },
        },
      },
      {},
    );
    const result = (await finalize_proposal.execute!(
      { session_id: SESSION },
      {},
    )) as {
      ok: true;
      proposal: {
        id: string;
        status: string;
        diff: { new_object_types: Record<string, unknown> };
      };
    };
    expect(result.proposal.status).toBe("pending");
    expect(result.proposal.diff.new_object_types["Thread"]).toBeDefined();
  });
});

describe("integration: three PROPOSE calls + finalize", () => {
  it("yields one proposal row containing all three changes", async () => {
    const store = new InMemoryProposalDraftStore();
    const {
      propose_object_type,
      propose_link_type,
      propose_shared_property,
      finalize_proposal,
    } = buildProposalTools(store);

    await propose_object_type.execute!(
      {
        session_id: SESSION,
        name: "Thread",
        definition: {
          description: "A forum thread",
          properties: {
            id: { type: "uuid", primary_key: true },
            title: { type: "string", required: true },
          },
        },
      },
      {},
    );

    await propose_link_type.execute!(
      {
        session_id: SESSION,
        name: "member_threads",
        definition: {
          from: "Member",
          to: "Thread",
          cardinality: "one-to-many",
        },
      },
      {},
    );

    await propose_shared_property.execute!(
      {
        session_id: SESSION,
        name: "tag",
        definition: { type: "string", description: "User-applied tag" },
      },
      {},
    );

    const finalized = (await finalize_proposal.execute!(
      { session_id: SESSION },
      {},
    )) as {
      ok: true;
      proposal: {
        id: string;
        session_id: string;
        status: string;
        diff: {
          new_object_types: Record<string, unknown>;
          new_link_types: Record<string, unknown>;
          new_shared_properties: Record<string, unknown>;
          modified_properties: Record<string, unknown>;
          impacted_tables: string[];
        };
      };
    };

    expect(finalized.proposal.status).toBe("pending");
    expect(finalized.proposal.session_id).toBe(SESSION);
    expect(Object.keys(finalized.proposal.diff.new_object_types)).toEqual([
      "Thread",
    ]);
    expect(Object.keys(finalized.proposal.diff.new_link_types)).toEqual([
      "member_threads",
    ]);
    expect(Object.keys(finalized.proposal.diff.new_shared_properties)).toEqual([
      "tag",
    ]);
    expect(finalized.proposal.diff.modified_properties).toEqual({});
    expect(finalized.proposal.diff.impacted_tables).toEqual(["Thread"]);

    const all = await store.listProposals();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(finalized.proposal.id);
  });
});
