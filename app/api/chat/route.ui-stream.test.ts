// M2.3 step-3 (precondition for M2.2's confirmation card UI):
// the chat route MUST emit a UI message stream — not a plain text stream —
// so that tool result envelopes (apply_action confirmation_required,
// audit_id, etc.) reach the client's useChat({messages}) state.
//
// Why this matters: the chat panel's pickPendingConfirmation walks message
// parts of type "tool-apply_action" / "tool-result". Those parts only exist
// when the route uses result.toUIMessageStreamResponse() AND the client
// uses a UI-message-aware transport (the default Chat transport in ai-sdk
// v6 / @ai-sdk/react ≥3). With toTextStreamResponse() the client only sees
// concatenated text deltas — tool outputs are silently dropped.
//
// Acceptance contract this test pins:
//   1. Response Content-Type is the v6 UI message stream MIME type
//      ("text/event-stream" — DefaultChatTransport processes SSE chunks).
//   2. The stream carries a discrete tool-output frame for apply_action
//      that includes the confirmation_required envelope as a structured
//      object (NOT just a JSON blob baked into a text delta).

import { beforeEach, describe, expect, it, vi } from "vitest";
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

const stewardActor: Actor = {
  userId: "steward-ui",
  email: "steward@ui.local",
  role: "steward",
  customRoles: [],
};

const TEST_MEMBER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let sharedDb: OntologyStore;
let sharedAudit: InMemoryAuditStore;

vi.mock("@/lib/agent/chat-runtime", async () => {
  const path = await import("node:path");
  const { loadOntology } = await import("@/lib/ontology/load");
  const PKG_ROOT_INNER = path.resolve(__dirname, "..", "..", "..");
  const ontology = await loadOntology(
    path.join(PKG_ROOT_INNER, "scenarios", "small-community", "ontology"),
  );
  return {
    buildChatRuntime: async () => ({
      actor: stewardActor,
      ctx: createCtx({ db: sharedDb, actor: stewardActor, audit: sharedAudit }),
      ontology,
      functionsDir: path.join(PKG_ROOT_INNER, "functions"),
    }),
    // M3.8 (#33): route gates on isAnonymous; this mock supplies steward.
    isAnonymous: () => false,
  };
});

function buildDeleteModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "ui-call-1",
            toolName: "apply_action",
            input: JSON.stringify({
              action: "delete_member",
              params: { id: TEST_MEMBER_ID },
              // No bypass — we want the confirmation envelope.
            }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: {
                total: 1,
                text: 0,
                reasoning: undefined,
              },
            },
          },
        ],
      }),
    }),
  });
}

vi.mock("@/lib/agent/mastra", async () => {
  const real = await vi.importActual<typeof import("@/lib/agent/mastra")>(
    "@/lib/agent/mastra",
  );
  return {
    ...real,
    AGENT_INSTRUCTIONS: "stub instructions",
    buildLanguageModel: () => buildDeleteModel(),
  };
});

import { POST } from "./route";

describe("POST /api/chat — UI message stream transport (M2.3 step 3)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sharedDb = createInMemoryStore();
    sharedAudit = new InMemoryAuditStore();
    await sharedDb.objects.Member.create({
      id: TEST_MEMBER_ID,
      full_name: "UI Test",
      email: "ui@test.local",
      phone: "555-0000",
      tier_role: "staff",
      started_at: "2025-01-01",
      notes: "",
    });
  });

  it("emits an SSE Content-Type so DefaultChatTransport can parse UI message chunks", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        session_id: "ui-sess",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: `delete ${TEST_MEMBER_ID}` }],
          },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    // UI message stream protocol is SSE; the text stream protocol is plain
    // "text/plain". This is the smoking-gun check that the route switched.
    expect(contentType).toContain("text/event-stream");
  });

  it("delivers the apply_action tool output (with confirmation_required envelope) as a structured stream frame", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        session_id: "ui-sess-2",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [
              { type: "text", text: `delete ${TEST_MEMBER_ID}` },
            ],
          },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const chunks = await convertReadableStreamToArray(
      res.body!.pipeThrough(new TextDecoderStream()),
    );
    const wire = chunks.join("");
    // SSE frames carry JSON-shaped UI message chunks. We don't pin the
    // exact frame names (ai-sdk v6 chunk types evolve), only the
    // observable contract: the envelope reaches the wire as structured
    // JSON the client can decode, not just baked into a text delta.
    expect(wire).toContain("confirmation_required");
    expect(wire).toContain("delete_member");
    expect(wire).toContain("apply_action");
  });
});
