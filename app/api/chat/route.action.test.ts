// M2.2 step-1: failing test that proves the chat route wires `apply_action`
// end-to-end through the in-process dispatcher with a real OntologyCtx +
// audit store.
//
// We mock the language model to deterministically emit a single tool call
// for `apply_action change_tier`. The route must:
//   1. Build a real ctx + dispatcher (PgOntologyStore in prod; in-memory here
//      for hermetic tests — wiring is identical).
//   2. Include `apply_action` in the ai-sdk tools record.
//   3. On stream completion: action_audit has a row AND member.tier is updated.
//
// Why in-memory store: the live Postgres at localhost:5432 is bound to MAIN's
// container, not the worktree, and the test must run without external state.
// Per [[gotcha-acropolisos-vitest-at-alias]] @/ resolves via vitest.config.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  MockLanguageModelV3,
  convertReadableStreamToArray,
  simulateReadableStream,
} from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { loadOntology } from "@/lib/ontology/load";
import {
  createCtx,
  createInMemoryStore,
  type OntologyStore,
} from "@/lib/ontology/ctx";
import { InMemoryAuditStore } from "@/lib/audit/writer";
import type { Actor } from "@/lib/ctx";

const PKG_ROOT = path.resolve(__dirname, "..", "..", "..");
const SEED_ROOT = path.join(PKG_ROOT, "seed", "small-community");
const FUNCTIONS_DIR = path.join(PKG_ROOT, "functions");

// Seeded member id is generated at insert; the test seeds its own row.
const TEST_MEMBER_ID = "11111111-1111-1111-1111-111111111111";

const stewardActor: Actor = {
  userId: "steward-test",
  email: "steward@test.local",
  role: "steward",
  customRoles: [],
};

// Shared store + audit so the test can inspect them after the stream drains.
// Re-created per test in beforeEach.
let sharedDb: OntologyStore;
let sharedAudit: InMemoryAuditStore;

// Stub the chat-runtime hook to inject our test ctx + actor instead of the
// production session-derived ones. M2.2 step 5 creates this hook in route.ts
// so the test can replace it. Factory must be hoist-safe: no module-scope
// reference may leak in (vi.mock is hoisted above the import block).
vi.mock("@/lib/agent/chat-runtime", async () => {
  const path = await import("node:path");
  const { loadOntology } = await import("@/lib/ontology/load");
  const PKG_ROOT_INNER = path.resolve(__dirname, "..", "..", "..");
  const ontology = await loadOntology(
    path.join(PKG_ROOT_INNER, "seed", "small-community"),
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

// Build a model that emits a single apply_action tool call with bypass=true,
// then stops. The route must convert this into a real dispatcher invocation.
function buildToolCallingModel(bypass: boolean): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "apply_action",
            input: JSON.stringify({
              action: "change_tier",
              params: {
                member: TEST_MEMBER_ID,
                new_tier: "work_trader",
              },
              ...(bypass ? { bypass_confirmation: true } : {}),
            }),
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
    }),
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

describe("POST /api/chat — apply_action wiring (M2.2 step 1)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sharedDb = createInMemoryStore();
    sharedAudit = new InMemoryAuditStore();
    // Seed one member we can mutate.
    await sharedDb.objects.Member.create({
      id: TEST_MEMBER_ID,
      full_name: "Test Member",
      email: "tm@test.local",
      phone: "555-0000",
      tier_role: "staff",
      started_at: "2025-01-01",
      notes: "",
    });
  });

  it("returns confirmation_required and DOES NOT mutate when bypass omitted", async () => {
    currentModel = buildToolCallingModel(false);
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        session_id: "test-session-1",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [
              {
                type: "text",
                text: `change ${TEST_MEMBER_ID} to sustaining`,
              },
            ],
          },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    await drainResponse(res);

    // No member mutation
    const after = await sharedDb.objects.Member.findById(TEST_MEMBER_ID);
    expect(after?.tier_role).toBe("staff");

    // No completed action audit row (only the pending pre-row, if any)
    const auditRows = await sharedAudit.listActionAudit();
    const okRow = auditRows.find(
      (r) => r.subject_id === "change_tier" && r.metadata.result === "ok",
    );
    expect(okRow).toBeUndefined();
  });

  it("mutates member.tier AND writes action_audit row when bypass_confirmation=true", async () => {
    currentModel = buildToolCallingModel(true);
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        session_id: "test-session-2",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [
              {
                type: "text",
                text: `confirmed: change ${TEST_MEMBER_ID} to sustaining`,
              },
            ],
          },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    await drainResponse(res);

    // Member tier updated
    const after = await sharedDb.objects.Member.findById(TEST_MEMBER_ID);
    expect(after?.tier_role).toBe("work_trader");

    // action_audit has an ok row for change_tier
    const auditRows = await sharedAudit.listActionAudit();
    const okRow = auditRows.find(
      (r) => r.subject_id === "change_tier" && r.metadata.result === "ok",
    );
    expect(okRow).toBeDefined();
    expect(okRow!.actor).toBe(stewardActor.userId);
  });
});
