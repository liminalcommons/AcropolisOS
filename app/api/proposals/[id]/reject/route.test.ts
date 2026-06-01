import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryProposalDraftStore } from "@/lib/proposals/store";

const store = new InMemoryProposalDraftStore();

vi.mock("@/lib/proposals/singleton", () => ({
  getProposalStore: () => store,
}));

// The real chat-runtime imports next-auth → next/server which fails to
// resolve under vitest's node environment. Mock it with a steward actor so
// the auth guard passes and we can test the reject logic. See
// route.withdraw.test.ts for the same pattern applied across all route tests.
vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: async () => ({
    actor: {
      userId: "u-steward",
      email: "steward@example.com",
      role: "steward",
      customRoles: [] as string[],
    },
  }),
  isAnonymous: (actor: { role?: string } | null) =>
    actor === null || actor.role === "anonymous",
}));

const { POST } = await import("./route");

const SAMPLE_OT = {
  properties: { id: { type: "uuid", primary_key: true } },
} as const;

async function seed(): Promise<string> {
  await store.appendObjectType("s1", "Thread", SAMPLE_OT);
  const p = await store.finalize("s1");
  return p.id;
}

describe("POST /api/proposals/[id]/reject", () => {
  beforeEach(async () => {
    const all = await store.listProposals();
    for (const p of all) {
      await store.setStatus(p.id, "rejected");
    }
  });

  it("marks the proposal rejected", async () => {
    const id = await seed();
    const res = await POST(
      new Request(`http://localhost/api/proposals/${id}/reject`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const fetched = await store.getProposal(id);
    expect(fetched?.status).toBe("rejected");
  });

  it("returns 404 for unknown id", async () => {
    const res = await POST(
      new Request("http://localhost/api/proposals/ghost/reject", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "ghost" }) },
    );
    expect(res.status).toBe(404);
  });
});
