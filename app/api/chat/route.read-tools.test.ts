// M2.x: failing test that proves the chat route wires read tools (query_member,
// read_member, describe_member) into the streamText tools surface.
//
// The agent should be able to LIST existing data through `query_<type>` before
// proposing anything new. Mirrors route.action.test.ts in structure: stub the
// language model to emit a single tool call for `query_member`, drain the
// response, and assert the tool fired against the in-memory store.

import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  MockLanguageModelV3,
  convertReadableStreamToArray,
  simulateReadableStream,
} from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import {
  createCtx,
  createInMemoryStore,
  type OntologyStore,
} from "@/lib/ontology/ctx";
import { InMemoryAuditStore } from "@/lib/audit/writer";
import type { Actor } from "@/lib/ctx";

const TEST_MEMBER_ID_1 = "11111111-1111-1111-1111-111111111111";
const TEST_MEMBER_ID_2 = "22222222-2222-2222-2222-222222222222";

const stewardActor: Actor = {
  userId: "steward-test",
  email: "steward@test.local",
  role: "steward",
  customRoles: [],
};

let sharedDb: OntologyStore;
let sharedAudit: InMemoryAuditStore;

vi.mock("@/lib/agent/chat-runtime", async () => {
  const path = await import("node:path");
  const { loadOntology } = await import("@/lib/ontology/load");
  const { buildReadToolsForActor } = await import("@/lib/agent/read-tools");
  const PKG_ROOT_INNER = path.resolve(__dirname, "..", "..", "..");
  const ontology = await loadOntology(
    path.join(PKG_ROOT_INNER, "seed", "small-community"),
  );
  return {
    buildChatRuntime: async () => {
      const ctx = createCtx({
        db: sharedDb,
        actor: stewardActor,
        audit: sharedAudit,
      });
      const readTools = buildReadToolsForActor({ ontology, ctx });
      return {
        actor: stewardActor,
        ctx,
        ontology,
        functionsDir: path.join(PKG_ROOT_INNER, "functions"),
        readTools,
      };
    },
  };
});

// Capture every tool call the model issues so we can assert query_member fired.
const toolCallSpy = vi.fn();

function buildQueryModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async ({ tools }) => {
      // Record the tool names the route exposed to the model so the test can
      // assert query_member / read_member / describe_member are present.
      toolCallSpy({
        toolNames: (tools ?? []).map((t) => (t as { name?: string }).name),
      });
      return {
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "query_member",
              input: JSON.stringify({}),
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: 5,
                  text: 0,
                  reasoning: undefined,
                },
              },
            },
          ],
        }),
      };
    },
  });
}

let currentModel: MockLanguageModelV3;

vi.mock("@/lib/agent/mastra", async () => {
  const real = await vi.importActual<typeof import("@/lib/agent/mastra")>(
    "@/lib/agent/mastra",
  );
  return {
    ...real,
    AGENT_INSTRUCTIONS: "stub instructions",
    buildLanguageModel: () => currentModel,
  };
});

import { POST } from "./route";

async function drainResponse(res: Response): Promise<string> {
  if (!res.body) return "";
  const chunks = await convertReadableStreamToArray(
    res.body.pipeThrough(new TextDecoderStream()),
  );
  return chunks.join("");
}

describe("POST /api/chat — read tools wiring", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sharedDb = createInMemoryStore();
    sharedAudit = new InMemoryAuditStore();
    await sharedDb.objects.Member.create({
      id: TEST_MEMBER_ID_1,
      full_name: "Alpha Member",
      email: "alpha@test.local",
      phone: "555-0001",
      tier_role: "staff",
      started_at: "2025-01-01",
      notes: "",
    });
    await sharedDb.objects.Member.create({
      id: TEST_MEMBER_ID_2,
      full_name: "Beta Member",
      email: "beta@test.local",
      phone: "555-0002",
      tier_role: "work_trader",
      started_at: "2025-02-01",
      notes: "",
    });
  });

  it("exposes query_member / read_member / describe_member to the model and the tool returns rows", async () => {
    currentModel = buildQueryModel();
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        session_id: "test-read-session",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [
              { type: "text", text: "what members do we have?" },
            ],
          },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await drainResponse(res);

    // The model saw all three read tools alongside apply_action + propose_*.
    expect(toolCallSpy).toHaveBeenCalled();
    const exposed: string[] = toolCallSpy.mock.calls[0][0].toolNames;
    expect(exposed).toContain("query_member");
    expect(exposed).toContain("read_member");
    expect(exposed).toContain("describe_member");
    expect(exposed).toContain("apply_action");

    // The stream surface includes the query_member tool-output frame with both
    // seeded members. toUIMessageStreamResponse encodes results inline.
    expect(body).toContain("Alpha Member");
    expect(body).toContain("Beta Member");
  });
});
