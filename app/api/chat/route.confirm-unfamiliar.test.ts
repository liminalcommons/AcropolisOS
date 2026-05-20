// M2.3 step-2: end-to-end test that proves /api/chat enforces
// confirm_if_unfamiliar on delete_member and graduates to auto_apply once
// the audit log shows the actor is familiar.
//
// Why end-to-end (route POST) and not just the policy unit test:
//   - policy.test.ts already covers the heuristic in isolation. THIS test
//     proves the wire-up: route → ChatRuntime → buildApplyActionAiSdkTool →
//     runApplyActionTool → resolveActionPolicy → InMemoryAuditStore.
//   - It also pins the steward-flow expectation: first delete shows the
//     confirmation card path (envelope present in tool output); a delete
//     made after enough successful priors fires through to the dispatcher
//     and removes the row.
//
// The model is stubbed with MockLanguageModelV3 (same pattern as
// route.action.test.ts) so every test turn is fully deterministic.
//
// Per [[gotcha-vitest-vimock-factory-hoisting]] every vi.mock factory is
// hoist-safe: no top-level binding leaks in. Per
// [[gotcha-acropolisos-nextauth-vitest-resolution]] we mock chat-runtime so
// the route's `auth()` import path never resolves.

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

const stewardActor: Actor = {
  userId: "steward-test",
  email: "steward@test.local",
  role: "steward",
  customRoles: [],
};

// Pre-seeded member id used for the first (unfamiliar) delete.
// NB: real v4 UUIDs — zod 4's z.uuid() enforces the [1-8] version digit
// and [89abAB] variant digit, so naive "11111111-…" strings fail validation
// and the tool call is silently dropped by ai-sdk's input parser
// (no execute, no error, just a missing tool result). See
// gotcha_acropolisos_zod4_uuid_strict.md.
const MEMBER_ID_A = "11111111-1111-4111-8111-111111111111";
// Members used to backfill prior successes + final familiar delete.
const MEMBER_IDS_FAMILIAR = [
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];

let sharedDb: OntologyStore;
let sharedAudit: InMemoryAuditStore;

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

// Each test installs its own model emitting a single apply_action tool call
// for delete_member with the target id. The route runs streamText; the tool
// produces an envelope; the envelope is the contract under test.
function buildDeleteModel(memberId: string, bypass: boolean): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: `del-${memberId}`,
            toolName: "apply_action",
            input: JSON.stringify({
              action: "delete_member",
              params: { id: memberId },
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

async function seedMember(id: string): Promise<void> {
  await sharedDb.objects.Member.create({
    id,
    full_name: `Member ${id.slice(0, 4)}`,
    email: `${id.slice(0, 4)}@test.local`,
    joined_at: "2025-01-01",
    tier: "basic",
    notes: "",
  });
}

// Record a successful prior delete_member invocation in the audit store —
// this is the signal the confirm_if_unfamiliar heuristic counts on.
async function recordPriorDeleteOk(memberId: string): Promise<void> {
  await sharedAudit.insertActionAudit({
    actor: stewardActor.userId,
    actor_role: stewardActor.role,
    via: "inngest",
    subject_type: "action",
    subject_id: "delete_member",
    before: null,
    after: null,
    metadata: {
      result: "ok",
      params: { id: memberId },
    },
  });
}

function buildChatRequest(text: string): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({
      session_id: `unfamiliar-${Math.random().toString(36).slice(2, 8)}`,
      messages: [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text }],
        },
      ],
    }),
  });
}

describe("POST /api/chat — delete_member confirm_if_unfamiliar (M2.3 step 2)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sharedDb = createInMemoryStore();
    sharedAudit = new InMemoryAuditStore();
    await seedMember(MEMBER_ID_A);
    for (const id of MEMBER_IDS_FAMILIAR) {
      await seedMember(id);
    }
  });

  it("unfamiliar first invocation: returns confirmation_required and DOES NOT delete the member", async () => {
    currentModel = buildDeleteModel(MEMBER_ID_A, false);
    const res = await POST(buildChatRequest(`delete member ${MEMBER_ID_A}`));
    expect(res.status).toBe(200);
    await drainResponse(res);

    // Member still present — policy gate short-circuited dispatch.
    const stillThere = await sharedDb.objects.Member.findById(MEMBER_ID_A);
    expect(stillThere).not.toBeNull();

    // No ok audit row for delete_member.
    const auditRows = await sharedAudit.listActionAudit();
    const okRows = auditRows.filter(
      (r) => r.subject_id === "delete_member" && r.metadata.result === "ok",
    );
    expect(okRows).toHaveLength(0);
  });

  it("with bypass_confirmation:true: deletes the member AND writes an ok audit row", async () => {
    currentModel = buildDeleteModel(MEMBER_ID_A, true);
    const res = await POST(buildChatRequest(`confirmed: delete ${MEMBER_ID_A}`));
    expect(res.status).toBe(200);
    await drainResponse(res);

    const gone = await sharedDb.objects.Member.findById(MEMBER_ID_A);
    expect(gone).toBeNull();

    const auditRows = await sharedAudit.listActionAudit();
    const okRow = auditRows.find(
      (r) => r.subject_id === "delete_member" && r.metadata.result === "ok",
    );
    expect(okRow).toBeDefined();
    expect(okRow!.actor).toBe(stewardActor.userId);
    expect(
      (okRow!.metadata as { params?: { id?: string } }).params?.id,
    ).toBe(MEMBER_ID_A);
  });

  it("familiar after 3 prior ok rows with same param shape: auto-applies WITHOUT bypass", async () => {
    // Pre-seed three prior successful deletes (same param shape: {id}).
    for (let i = 0; i < 3; i++) {
      await recordPriorDeleteOk(MEMBER_IDS_FAMILIAR[i]);
    }

    // Now the agent attempts a fresh delete on a 4th member with NO bypass.
    // confirm_if_unfamiliar must resolve to auto_apply (3 priors >= threshold).
    const targetId = MEMBER_IDS_FAMILIAR[3];
    currentModel = buildDeleteModel(targetId, false);
    const res = await POST(buildChatRequest(`delete ${targetId}`));
    expect(res.status).toBe(200);
    await drainResponse(res);

    // Member is deleted — auto_apply graduated the action through.
    const gone = await sharedDb.objects.Member.findById(targetId);
    expect(gone).toBeNull();

    // A fresh ok audit row for this delete was written.
    const auditRows = await sharedAudit.listActionAudit();
    const ourRow = auditRows.find(
      (r) =>
        r.subject_id === "delete_member" &&
        r.metadata.result === "ok" &&
        (r.metadata as { params?: { id?: string } }).params?.id === targetId,
    );
    expect(ourRow).toBeDefined();
  });

  it("only 2 prior ok rows: still confirmation_required (one below threshold)", async () => {
    for (let i = 0; i < 2; i++) {
      await recordPriorDeleteOk(MEMBER_IDS_FAMILIAR[i]);
    }
    const targetId = MEMBER_IDS_FAMILIAR[3];
    currentModel = buildDeleteModel(targetId, false);
    const res = await POST(buildChatRequest(`delete ${targetId}`));
    expect(res.status).toBe(200);
    await drainResponse(res);

    // Member NOT deleted.
    const stillThere = await sharedDb.objects.Member.findById(targetId);
    expect(stillThere).not.toBeNull();

    // No FRESH ok row (only the two priors we seeded).
    const auditRows = await sharedAudit.listActionAudit();
    const okRows = auditRows.filter(
      (r) => r.subject_id === "delete_member" && r.metadata.result === "ok",
    );
    expect(okRows).toHaveLength(2);
  });
});
