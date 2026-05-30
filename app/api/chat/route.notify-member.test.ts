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
    path.join(PKG_ROOT_INNER, "scenarios", "small-community", "ontology"),
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
    // M3.8 (#33): route gates on isAnonymous; this mock supplies steward.
    isAnonymous: () => false,
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
                new_tier: "work_trader",
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
      phone: "555-0000",
      tier_role: "staff",
      started_at: "2025-01-01",
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
      expect(member?.tier_role).toBe("work_trader");

      // 2. action_audit rows recorded for change_tier — pending + ok.
      const auditRows = await sharedAudit.listActionAudit();
      const okRow = auditRows.find(
        (r) =>
          r.subject_type === "action" &&
          r.subject_id === "change_tier" &&
          r.metadata.result === "ok",
      );
      expect(okRow).toBeDefined();
      const changeTierActionIds = auditRows
        .filter(
          (r) => r.subject_type === "action" && r.subject_id === "change_tier",
        )
        .map((r) => r.id);
      // The pending row is the action's stable identity (created in audit_pre
      // before the handler runs); dispatchSideEffects fires after audit_post
      // and links the child side_effect rows to that pending id. We accept
      // either the pending or the ok row here to stay decoupled from that
      // invariant (both belong to the same change_tier invocation).
      expect(changeTierActionIds.length).toBeGreaterThanOrEqual(1);

      // 3. Child side_effect audit row for notify_member, linked to one of
      //    the change_tier action rows above.
      const sideEffect = auditRows.find(
        (r) =>
          r.subject_type === "side_effect" &&
          r.subject_id === "notify_member",
      );
      expect(sideEffect, "expected side_effect audit row").toBeDefined();
      expect(changeTierActionIds).toContain(
        sideEffect!.metadata.parent_action_audit_id,
      );
      expect(sideEffect!.metadata.status).toBe("ok");
      expect(sideEffect!.metadata.action_type).toBe("change_tier");

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
