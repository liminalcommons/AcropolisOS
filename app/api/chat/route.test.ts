import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MockLanguageModelV3,
  convertReadableStreamToArray,
  simulateReadableStream,
} from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";

// M2.2: route now imports chat-runtime which pulls NextAuth. Stub it so this
// suite stays focused on the streaming surface.
vi.mock("@/lib/agent/chat-runtime", async () => {
  const path = await import("node:path");
  const { loadOntology } = await import("@/lib/ontology/load");
  const { createCtx, createInMemoryStore } = await import("@/lib/ontology/ctx");
  const { InMemoryAuditStore } = await import("@/lib/audit/writer");
  const PKG_ROOT = path.resolve(__dirname, "..", "..", "..");
  const ontology = await loadOntology(
    path.join(PKG_ROOT, "seed", "small-community"),
  );
  return {
    buildChatRuntime: async () => {
      const db = createInMemoryStore();
      const audit = new InMemoryAuditStore();
      const actor = {
        userId: "u",
        email: "u@x",
        role: "steward" as const,
        customRoles: [] as string[],
      };
      return {
        actor,
        ctx: createCtx({ db, actor, audit }),
        ontology,
        functionsDir: path.join(PKG_ROOT, "functions"),
      };
    },
    // M3.8 (#33): route now gates on isAnonymous(runtime.actor) before
    // wiring the dispatcher; mocked actor is authenticated (role: steward)
    // so we hard-code false.
    isAnonymous: () => false,
  };
});

vi.mock("@/lib/agent/mastra", () => ({
  AGENT_INSTRUCTIONS: "stub instructions",
  buildLanguageModel: () =>
    new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "Hello" },
            { type: "text-delta", id: "1", delta: " world" },
            { type: "text-end", id: "1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: 2,
                  text: 2,
                  reasoning: undefined,
                },
              },
            },
          ],
        }),
      }),
    }),
}));

import { POST } from "./route";

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects body without messages array", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ foo: "bar" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("streams a UI message stream for a single UIMessage body (M2.3 transport)", async () => {
    // The route now emits result.toUIMessageStreamResponse() so tool
    // outputs (apply_action confirmation envelopes, propose_* results) can
    // round-trip to useChat({messages}). The text deltas show up as
    // data: {"type":"text-delta",...} SSE frames, not raw concatenated text.
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain(
      "text/event-stream",
    );
    expect(res.body).toBeTruthy();
    const chunks = await convertReadableStreamToArray(
      res.body!.pipeThrough(new TextDecoderStream()),
    );
    const wire = chunks.join("");
    // Both text deltas survive as discrete frames.
    expect(wire).toContain("Hello");
    expect(wire).toContain("world");
    // Frames are SSE-formatted.
    expect(wire).toMatch(/^data: /m);
  });
});
