// M2.4 step-1: failing E2E that proves the chat route fires the
// notify_member side-effect after a successful apply_action invocation
// AND records each side-effect dispatch result as a child action_audit row
// (subject_type="side_effect", subject_id=channel name) linked back to the
// parent action_audit row via metadata.parent_action_audit_id.
//
// Why this is the first M2.4 RED test:
//   - chat-runtime today does NOT pass sideEffectAdapters into the
//     dispatcher, so notify_member never fires from /api/chat.
//   - dispatchSideEffects today returns results in memory but never writes
//     them into the audit store — there is no observable side_effect entry.
//   - change-tier.yaml already declares side_effects: [audit, notify_member].
//
// We intercept console.log so the structured stdout adapter (M2.4 step 2)
// can be asserted directly without touching real SMTP/Resend, and we inspect
// sharedAudit for the per-channel side_effect rows the runtime must emit.

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

const PKG_ROOT = path.resolve(__dirname, "..", "..", "..");

const TEST_MEMBER_ID = "22222222-2222-4222-8222-222222222222";

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
  const PKG_ROOT_INNER = path.resolve(__dirname, "..", "..", "..");
  const ontology = await loadOntology(
    path.join(PKG_ROOT_INNER, "seed", "small-community"),
  );
  // Import the real notify-stdout + dispatchSideEffectAdapters factory so
  // the route's side-effect runtime fires through to the structured stdout
  // adapter. The factory is created in M2.4 step 2.
  const { resolveSideEffectAdapters } = await import(
    "@/lib/actions/side-effects-runtime"
  );
  return {
    buildChatRuntime: async () => {
      const ctx = createCtx({
        db: sharedDb,
        actor: stewardActor,
        audit: sharedAudit,
      });
      return {
        actor: stewardActor,
        ctx,
        ontology,
        functionsDir: path.join(PKG_ROOT_INNER, "functions"),
        // M2.4 step-4: the route must accept adapters from chat-runtime and
        // forward them into createInProcessDispatcher.
        sideEffectAdapters: resolveSideEffectAdapters({}),
      };
    },
  };
});

function buildToolCallingModel(): MockLanguageModelV3 {
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
                new_tier: "sustaining",
              },
              bypass_confirmation: true,
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

describe("POST /api/chat — notify_member side-effect (M2.4 step 1)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sharedDb = createInMemoryStore();
    sharedAudit = new InMemoryAuditStore();
    await sharedDb.objects.Member.create({
      id: TEST_MEMBER_ID,
      full_name: "Notified Member",
      email: "notified@test.local",
      joined_at: "2025-01-01",
      tier: "basic",
      notes: "",
    });
  });

  it("writes structured JSON log line AND audit child row when notify_member fires", async () => {
    currentModel = buildToolCallingModel();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          session_id: "test-notify-1",
          messages: [
            {
              id: "m1",
              role: "user",
              parts: [
                {
                  type: "text",
                  text: `confirmed: notify ${TEST_MEMBER_ID}`,
                },
              ],
            },
          ],
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      await drainResponse(res);

      // 1. Member mutation landed (sanity).
      const member = await sharedDb.objects.Member.findById(TEST_MEMBER_ID);
      expect(member?.tier).toBe("sustaining");

      // 2. Parent action_audit row recorded for change_tier.
      const auditRows = await sharedAudit.listActionAudit();
      const parent = auditRows.find(
        (r) =>
          r.subject_type === "action" &&
          r.subject_id === "change_tier" &&
          r.metadata.result === "ok",
      );
      expect(parent).toBeDefined();

      // 3. Child side_effect audit row for notify_member, linked to parent.
      const sideEffect = auditRows.find(
        (r) =>
          r.subject_type === "side_effect" &&
          r.subject_id === "notify_member",
      );
      expect(sideEffect, "expected side_effect audit row").toBeDefined();
      expect(sideEffect!.metadata.parent_action_audit_id).toBe(parent!.id);
      expect(sideEffect!.metadata.status).toBe("ok");

      // 4. Structured JSON log line emitted by the stdout adapter.
      const jsonLines = logSpy.mock.calls
        .map((args) => String(args[0]))
        .filter((s) => s.startsWith("{") && s.includes("notify_member"));
      expect(jsonLines.length).toBeGreaterThan(0);
      const parsed = JSON.parse(jsonLines[0]) as Record<string, unknown>;
      expect(parsed.event).toBe("notify_member");
      expect(parsed.recipient).toBe("steward@test.local");
      expect(parsed.action_type).toBe("change_tier");
    } finally {
      logSpy.mockRestore();
    }
  });
});
