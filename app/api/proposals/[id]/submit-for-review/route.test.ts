import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryProposalDraftStore } from "@/lib/proposals/store";

const store = new InMemoryProposalDraftStore();

// Mock chat-runtime so next-auth's next/server CJS import never materialises
// in vitest. Returns a member actor so the route proceeds past the auth gate
// (isAnonymous check). Pattern mirrors apply/route.test.ts (M3.8 update).
vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: async () => ({
    actor: {
      userId: "member-1",
      email: "member@example.com",
      role: "member",
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
const dispatched: Array<{ proposalId: string; submittedBy?: string }> = [];

vi.mock("@/lib/proposals/singleton", () => ({
  getProposalStore: () => store,
}));

vi.mock("@/lib/proposals/notify", () => ({
  notifyStewardsOfProposal: async (input: {
    proposalId: string;
    submittedBy?: string;
  }) => {
    dispatched.push(input);
  },
}));

const { POST } = await import("./route");

const SAMPLE_OT = {
  properties: { id: { type: "uuid", primary_key: true } },
} as const;

async function seed(session_id = "s1"): Promise<string> {
  await store.appendObjectType(session_id, "Thread", SAMPLE_OT);
  const p = await store.finalize(session_id);
  return p.id;
}

describe("POST /api/proposals/[id]/submit-for-review", () => {
  beforeEach(async () => {
    dispatched.length = 0;
    const all = await store.listProposals();
    for (const p of all) {
      await store.setStatus(p.id, "rejected");
    }
  });

  it("dispatches a steward notification and leaves the proposal pending", async () => {
    const id = await seed();
    const res = await POST(
      new Request(`http://localhost/api/proposals/${id}/submit-for-review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submitted_by: "member@example.com" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const fetched = await store.getProposal(id);
    expect(fetched?.status).toBe("pending");
    expect(dispatched).toEqual([
      { proposalId: id, submittedBy: "member@example.com" },
    ]);
  });

  it("works without submitted_by body", async () => {
    const id = await seed();
    const res = await POST(
      new Request(`http://localhost/api/proposals/${id}/submit-for-review`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    expect(dispatched).toEqual([{ proposalId: id, submittedBy: undefined }]);
  });

  it("returns 404 for unknown id without dispatching", async () => {
    const res = await POST(
      new Request("http://localhost/api/proposals/ghost/submit-for-review", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "ghost" }) },
    );
    expect(res.status).toBe(404);
    expect(dispatched).toEqual([]);
  });
});
