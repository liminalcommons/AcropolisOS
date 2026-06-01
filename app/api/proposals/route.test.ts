import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryProposalDraftStore } from "@/lib/proposals/store";

const store = new InMemoryProposalDraftStore();

vi.mock("@/lib/proposals/singleton", () => ({
  getProposalStore: () => store,
}));

// Stub chat-runtime so next-auth / next/server are never loaded in the test
// environment. The route uses buildChatRuntime() only to resolve the actor;
// these list tests assume an authenticated steward caller and don't exercise
// the 401 path (that is covered by route.unauth.test.ts siblings elsewhere).
vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: async () => ({
    actor: {
      userId: "steward-test",
      email: "steward@example.com",
      role: "steward",
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
    readTools: {},
  }),
  isAnonymous: (actor: { role?: string } | null) =>
    actor === null || actor.role === "anonymous",
}));

// Import after the mock is registered.
const { GET } = await import("./route");

const SAMPLE_OT = {
  properties: { id: { type: "uuid", primary_key: true } },
} as const;

function makeReq(url = "http://localhost/api/proposals"): Request {
  return new Request(url, { method: "GET" });
}

describe("GET /api/proposals", () => {
  beforeEach(async () => {
    // Drain the singleton between tests.
    const all = await store.listProposals();
    for (const p of all) {
      await store.setStatus(p.id, "rejected");
    }
  });

  it("returns an empty list when nothing is pending", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposals: unknown[] };
    expect(body.proposals).toEqual([]);
  });

  it("returns pending proposals sorted by created_at desc", async () => {
    await store.appendObjectType("s-old", "Old", SAMPLE_OT);
    const older = await store.finalize("s-old");
    // Force a measurable gap so created_at differs.
    await new Promise((r) => setTimeout(r, 5));
    await store.appendObjectType("s-new", "New", SAMPLE_OT);
    const newer = await store.finalize("s-new");

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      proposals: Array<{ id: string; status: string }>;
    };
    expect(body.proposals.map((p) => p.id)).toEqual([newer.id, older.id]);
    expect(body.proposals.every((p) => p.status === "pending")).toBe(true);
  });

  it("excludes approved and rejected proposals", async () => {
    await store.appendObjectType("s1", "A", SAMPLE_OT);
    const p1 = await store.finalize("s1");
    await store.appendObjectType("s2", "B", SAMPLE_OT);
    const p2 = await store.finalize("s2");
    await store.setStatus(p1.id, "approved");
    await store.setStatus(p2.id, "rejected");

    const res = await GET(makeReq());
    const body = (await res.json()) as { proposals: unknown[] };
    expect(body.proposals).toEqual([]);
  });

  it("filters by session_id when ?session_id=… is set", async () => {
    await store.appendObjectType("mine", "Mine", SAMPLE_OT);
    const mine = await store.finalize("mine");
    await store.appendObjectType("yours", "Yours", SAMPLE_OT);
    await store.finalize("yours");

    const res = await GET(
      makeReq("http://localhost/api/proposals?session_id=mine"),
    );
    const body = (await res.json()) as {
      proposals: Array<{ id: string; session_id: string }>;
    };
    expect(body.proposals.map((p) => p.id)).toEqual([mine.id]);
  });
});
