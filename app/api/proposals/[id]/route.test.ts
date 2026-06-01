import { beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { InMemoryProposalDraftStore } from "@/lib/proposals/store";
import { emptyDraft } from "@/lib/proposals/diff";

const store = new InMemoryProposalDraftStore();

vi.mock("@/lib/proposals/singleton", () => ({
  getProposalStore: () => store,
}));

// route.ts imports buildChatRuntime which pulls in next-auth; under vitest's
// node environment next/server is not resolvable.  Stub the entire module so
// the suite stays focused on the GET / PATCH surface.  All tests run as an
// authenticated steward so the auth gate never fires.
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

const { GET, PATCH } = await import("./route");

const SAMPLE_OT = {
  properties: { id: { type: "uuid", primary_key: true } },
} as const;

async function seed(): Promise<string> {
  await store.appendObjectType("s1", "Thread", SAMPLE_OT);
  const p = await store.finalize("s1");
  return p.id;
}

function req(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

describe("/api/proposals/[id]", () => {
  beforeEach(async () => {
    const all = await store.listProposals();
    for (const p of all) {
      await store.setStatus(p.id, "rejected");
    }
  });

  it("GET returns 404 for unknown id", async () => {
    const res = await GET(req("http://localhost/api/proposals/ghost"), {
      params: Promise.resolve({ id: "ghost" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET returns proposal payload for known id", async () => {
    const id = await seed();
    const res = await GET(req(`http://localhost/api/proposals/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      proposal: { id: string; diff: { new_object_types: Record<string, unknown> } };
    };
    expect(body.proposal.id).toBe(id);
    expect(body.proposal.diff.new_object_types["Thread"]).toBeDefined();
  });

  it("PATCH replaces the diff when given valid yaml_diff", async () => {
    const id = await seed();
    const nextDiff = {
      ...emptyDraft(),
      new_object_types: { Post: SAMPLE_OT },
      impacted_tables: ["Post"],
    };
    const res = await PATCH(
      req(`http://localhost/api/proposals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ yaml_diff: stringifyYaml(nextDiff) }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const fetched = await store.getProposal(id);
    expect(Object.keys(fetched!.diff.new_object_types)).toEqual(["Post"]);
    expect(fetched!.diff.impacted_tables).toEqual(["Post"]);
  });

  it("PATCH rejects malformed yaml with 400", async () => {
    const id = await seed();
    const res = await PATCH(
      req(`http://localhost/api/proposals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ yaml_diff: "not: : yaml" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it("PATCH rejects diff that fails schema validation", async () => {
    const id = await seed();
    const res = await PATCH(
      req(`http://localhost/api/proposals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ yaml_diff: stringifyYaml({ foo: "bar" }) }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it("PATCH returns 404 for unknown id", async () => {
    const res = await PATCH(
      req(`http://localhost/api/proposals/ghost`, {
        method: "PATCH",
        body: JSON.stringify({ yaml_diff: stringifyYaml(emptyDraft()) }),
      }),
      { params: Promise.resolve({ id: "ghost" }) },
    );
    expect(res.status).toBe(404);
  });
});
