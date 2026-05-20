// M3.8 step-1: POST /api/chat must reject anonymous callers BEFORE
// constructing the dispatcher / tools / streamText. Otherwise an
// unauthenticated POST would stream agent output and could invoke
// apply_action (issue #33).
//
// We mock buildChatRuntime to return an anonymous actor (role: "anonymous")
// and assert the route short-circuits with a 401 — NOT a 200 SSE stream.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: async () => ({
    actor: {
      userId: "anonymous",
      email: "",
      role: "anonymous",
      customRoles: [] as string[],
    },
    ctx: { actor: null },
    ontology: {
      object_types: {},
      link_types: {},
      property_types: {},
      action_types: {},
      roles: {},
      ingest_mappings: {},
    },
    functionsDir: "",
    sideEffectAdapters: {},
  }),
  isAnonymous: (actor: { role?: string } | null) =>
    actor === null || actor.role === "anonymous",
}));

// The route also imports mastra (buildLanguageModel) and proposal-tools.
// Stub them so we don't pull in heavy deps for this hermetic test — the route
// must reject before it ever touches them anyway, so the stubs double as
// guard rails (if the route mistakenly invokes them, the test will still pass
// the 401 assertion, but we'll spot a regression via vi.fn call counts).
const buildLanguageModelMock = vi.fn(() => {
  throw new Error(
    "buildLanguageModel must NOT be called for anonymous /api/chat",
  );
});
vi.mock("@/lib/agent/mastra", () => ({
  AGENT_INSTRUCTIONS: "stub",
  buildLanguageModel: () => buildLanguageModelMock(),
}));

vi.mock("@/lib/proposals/ai-sdk-tools", () => ({
  buildAiSdkProposalTools: () => ({}),
}));
vi.mock("@/lib/proposals/singleton", () => ({
  getProposalStore: () => ({}),
}));
vi.mock("@/lib/inbox/singleton", () => ({
  getInboxStore: () => ({}),
}));
vi.mock("@/lib/actions/dispatcher", () => ({
  createInProcessDispatcher: () => {
    throw new Error("dispatcher must NOT be wired for anonymous /api/chat");
  },
}));
vi.mock("@/lib/agent/apply-action-ai-sdk", () => ({
  buildApplyActionAiSdkTool: () => {
    throw new Error("apply_action tool must NOT be built for anonymous /api/chat");
  },
}));

import { POST } from "./route";

describe("POST /api/chat — anonymous rejection (M3.8 #33)", () => {
  it("returns 401 without setting up the dispatcher or streaming", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    // Response should NOT be an SSE stream.
    expect(res.headers.get("content-type") ?? "").not.toContain(
      "text/event-stream",
    );
    expect(buildLanguageModelMock).not.toHaveBeenCalled();
  });
});
