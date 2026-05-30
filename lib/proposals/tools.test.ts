import { describe, expect, it } from "vitest";
import { Tool } from "@mastra/core/tools";
import { InMemoryProposalDraftStore } from "./store";
import { buildProposalTools } from "./tools";

const SESSION = "session-abc";

describe("buildProposalTools — registration", () => {
  it("registers all nine required tool ids", () => {
    const store = new InMemoryProposalDraftStore();
    const { tools } = buildProposalTools(store);
    expect(Object.keys(tools).sort()).toEqual([
      "finalize_proposal",
      "propose_action_type",
      "propose_function",
      "propose_ingest",
      "propose_link_type",
      "propose_object_type",
      "propose_seed",
      "propose_shared_property",
      "propose_view",
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

describe("propose_action_type tool", () => {
  it("writes the proposed action type and updates impacted_tables when creates_object is set", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_action_type } = buildProposalTools(store);
    const result = (await propose_action_type.execute!(
      {
        session_id: SESSION,
        name: "create_thread",
        definition: {
          description: "Create a forum thread",
          creates_object: "Thread",
          agent_policy: "always_confirm",
        },
      },
      {},
    )) as {
      ok: true;
      draft: {
        new_action_types: Record<string, unknown>;
        impacted_tables: string[];
      };
    };
    expect(result.draft.new_action_types["create_thread"]).toBeDefined();
    expect(result.draft.impacted_tables).toContain("Thread");
  });
});

describe("propose_function tool", () => {
  it("stores TS body verbatim under the filename key", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_function } = buildProposalTools(store);
    const body = "export function hello() { return 'hi'; }";
    const result = (await propose_function.execute!(
      {
        session_id: SESSION,
        filename: "hello.ts",
        ts_body: body,
      },
      {},
    )) as {
      ok: true;
      draft: { new_functions: Record<string, { ts_body: string }> };
    };
    expect(result.draft.new_functions["hello.ts"].ts_body).toBe(body);
  });
});

describe("propose_view tool", () => {
  it("keys config views by scope:scope_key and preserves descriptors", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_view } = buildProposalTools(store);
    const result = (await propose_view.execute!(
      {
        session_id: SESSION,
        proposal: {
          scope: "role",
          scope_key: "steward",
          descriptors: [
            { id: "v1", kind: "metric", config: { type: "member", agg: "count" } },
          ],
        },
      },
      {},
    )) as {
      ok: true;
      draft: {
        new_view_configs: Record<string, { descriptors: { id: string }[] }>;
      };
    };
    expect(result.draft.new_view_configs["role:steward"].descriptors[0].id).toBe(
      "v1",
    );
  });
});

describe("propose_seed tool", () => {
  it("stores rows JSONL and marks the object type as impacted", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_seed } = buildProposalTools(store);
    const jsonl = '{"id":"1","title":"x"}\n{"id":"2","title":"y"}';
    const result = (await propose_seed.execute!(
      {
        session_id: SESSION,
        object_type: "Thread",
        rows_jsonl: jsonl,
      },
      {},
    )) as {
      ok: true;
      draft: {
        new_seeds: Record<string, { rows_jsonl: string }>;
        impacted_tables: string[];
      };
    };
    expect(result.draft.new_seeds["Thread"].rows_jsonl).toBe(jsonl);
    expect(result.draft.impacted_tables).toContain("Thread");
  });
});

describe("propose_ingest tool", () => {
  it("stores ingest config and marks the target object type as impacted", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_ingest } = buildProposalTools(store);
    const result = (await propose_ingest.execute!(
      {
        session_id: SESSION,
        name: "email_to_thread",
        inbox_ids: ["inbox-1", "inbox-2"],
        target_object_type: "Thread",
        mapping: { subject: "title", body: "content" },
      },
      {},
    )) as {
      ok: true;
      draft: {
        new_ingests: Record<
          string,
          {
            inbox_ids: string[];
            target_object_type: string;
            mapping: Record<string, string>;
          }
        >;
        impacted_tables: string[];
      };
    };
    expect(result.draft.new_ingests["email_to_thread"].inbox_ids).toEqual([
      "inbox-1",
      "inbox-2",
    ]);
    expect(
      result.draft.new_ingests["email_to_thread"].target_object_type,
    ).toBe("Thread");
    expect(result.draft.new_ingests["email_to_thread"].mapping).toEqual({
      subject: "title",
      body: "content",
    });
    expect(result.draft.impacted_tables).toContain("Thread");
  });

  it("rejects empty inbox_ids", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_ingest } = buildProposalTools(store);
    const result = (await propose_ingest.execute!(
      {
        session_id: SESSION,
        name: "bad",
        inbox_ids: [],
        target_object_type: "Thread",
        mapping: {},
      },
      {},
    )) as { error?: boolean; message?: string };
    expect(result.error).toBe(true);
    expect(result.message).toContain("inbox_ids");
  });
});

describe("integration: round-trip with all proposal types", () => {
  it("a single proposal carries object_type, link_type, shared_property, action_type, function, view, seed, and ingest cleanly", async () => {
    const store = new InMemoryProposalDraftStore();
    const {
      propose_object_type,
      propose_link_type,
      propose_shared_property,
      propose_action_type,
      propose_function,
      propose_view,
      propose_seed,
      propose_ingest,
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
        definition: { type: "string", description: "User tag" },
      },
      {},
    );
    await propose_action_type.execute!(
      {
        session_id: SESSION,
        name: "create_thread",
        definition: {
          description: "Create a thread",
          creates_object: "Thread",
          agent_policy: "always_confirm",
        },
      },
      {},
    );
    await propose_function.execute!(
      {
        session_id: SESSION,
        filename: "createThread.ts",
        ts_body: "export async function createThread() { /* ... */ }",
      },
      {},
    );
    await propose_view.execute!(
      {
        session_id: SESSION,
        proposal: {
          scope: "role",
          scope_key: "steward",
          descriptors: [
            { id: "v1", kind: "roster", config: { type: "thread", fields: ["title"] } },
          ],
        },
      },
      {},
    );
    await propose_seed.execute!(
      {
        session_id: SESSION,
        object_type: "Thread",
        rows_jsonl: '{"id":"seed-1","title":"Welcome"}',
      },
      {},
    );
    await propose_ingest.execute!(
      {
        session_id: SESSION,
        name: "email_to_thread",
        inbox_ids: ["inbox-1"],
        target_object_type: "Thread",
        mapping: { subject: "title" },
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
        diff: {
          new_object_types: Record<string, unknown>;
          new_link_types: Record<string, unknown>;
          new_shared_properties: Record<string, unknown>;
          new_action_types: Record<string, unknown>;
          new_functions: Record<string, { ts_body: string }>;
          new_view_configs: Record<
            string,
            { descriptors: { id: string }[] }
          >;
          new_seeds: Record<string, { rows_jsonl: string }>;
          new_ingests: Record<
            string,
            { inbox_ids: string[]; target_object_type: string }
          >;
          impacted_tables: string[];
        };
      };
    };

    expect(Object.keys(finalized.proposal.diff.new_object_types)).toEqual([
      "Thread",
    ]);
    expect(Object.keys(finalized.proposal.diff.new_link_types)).toEqual([
      "member_threads",
    ]);
    expect(Object.keys(finalized.proposal.diff.new_shared_properties)).toEqual([
      "tag",
    ]);
    expect(Object.keys(finalized.proposal.diff.new_action_types)).toEqual([
      "create_thread",
    ]);
    expect(
      finalized.proposal.diff.new_functions["createThread.ts"].ts_body,
    ).toContain("createThread");
    expect(
      finalized.proposal.diff.new_view_configs["role:steward"].descriptors[0]
        .id,
    ).toBe("v1");
    expect(finalized.proposal.diff.new_seeds["Thread"].rows_jsonl).toContain(
      "Welcome",
    );
    expect(
      finalized.proposal.diff.new_ingests["email_to_thread"].inbox_ids,
    ).toEqual(["inbox-1"]);
    expect(finalized.proposal.diff.impacted_tables).toEqual(["Thread"]);

    expect(await store.getDraft(SESSION)).toBeNull();
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
