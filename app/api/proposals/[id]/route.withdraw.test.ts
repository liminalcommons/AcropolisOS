// Revisable proposals: DELETE /api/proposals/[id] hard-withdraws a PENDING
// proposal. Steward-gated (role === "steward"); 401 anonymous, 403 member.
//
// These suites mock @/lib/agent/chat-runtime to control the actor role. The
// real builder imports next-auth, which fails to load under vitest's node env
// (Cannot find module 'next/server') — every route test in this package mocks
// chat-runtime for the same reason.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryProposalDraftStore } from "@/lib/proposals/store";

const store = new InMemoryProposalDraftStore();

vi.mock("@/lib/proposals/singleton", () => ({
  getProposalStore: () => store,
}));

const SAMPLE_OT = {
  properties: { id: { type: "uuid", primary_key: true } },
} as const;

async function seed(): Promise<string> {
  await store.appendObjectType("s1", "Thread", SAMPLE_OT);
  const p = await store.finalize("s1");
  return p.id;
}

function delReq(id: string): Request {
  return new Request(`http://localhost/api/proposals/${id}`, {
    method: "DELETE",
  });
}

describe("DELETE /api/proposals/[id] — steward withdraw", () => {
  beforeEach(async () => {
    vi.resetModules();
    const all = await store.listProposals();
    for (const p of all) {
      // Drain by status flip so withdraw() sees a clean pending set per test.
      if (p.status === "pending") await store.setStatus(p.id, "rejected");
    }
  });

  it("removes a pending proposal and returns { ok, removed: true }", async () => {
    vi.doMock("@/lib/agent/chat-runtime", () => ({
      buildChatRuntime: async () => ({
        actor: {
          userId: "u-1",
          email: "steward@example.com",
          role: "steward",
          customRoles: [] as string[],
        },
      }),
      isAnonymous: (actor: { role?: string } | null) =>
        actor === null || actor.role === "anonymous",
    }));
    const { DELETE } = await import("./route");
    const id = await seed();
    const res = await DELETE(delReq(id), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; removed: boolean };
    expect(body).toEqual({ ok: true, removed: true });
    expect(await store.getProposal(id)).toBeNull();
  });

  it("returns removed: false (404) for an unknown id", async () => {
    vi.doMock("@/lib/agent/chat-runtime", () => ({
      buildChatRuntime: async () => ({
        actor: {
          userId: "u-1",
          email: "steward@example.com",
          role: "steward",
          customRoles: [] as string[],
        },
      }),
      isAnonymous: (actor: { role?: string } | null) =>
        actor === null || actor.role === "anonymous",
    }));
    const { DELETE } = await import("./route");
    const res = await DELETE(delReq("ghost"), {
      params: Promise.resolve({ id: "ghost" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; removed: boolean };
    expect(body.removed).toBe(false);
  });

  it("returns 403 for an authenticated member (role !== steward)", async () => {
    vi.doMock("@/lib/agent/chat-runtime", () => ({
      buildChatRuntime: async () => ({
        actor: {
          userId: "u-2",
          email: "member@example.com",
          role: "member",
          customRoles: [] as string[],
        },
      }),
      isAnonymous: (actor: { role?: string } | null) =>
        actor === null || actor.role === "anonymous",
    }));
    const { DELETE } = await import("./route");
    const id = await seed();
    const res = await DELETE(delReq(id), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(403);
    // Member must not be able to delete the row.
    expect(await store.getProposal(id)).not.toBeNull();
  });

  it("returns 401 for an anonymous caller", async () => {
    vi.doMock("@/lib/agent/chat-runtime", () => ({
      buildChatRuntime: async () => ({
        actor: {
          userId: "anonymous",
          email: "",
          role: "anonymous",
          customRoles: [] as string[],
        },
      }),
      isAnonymous: (actor: { role?: string } | null) =>
        actor === null || actor.role === "anonymous",
    }));
    const { DELETE } = await import("./route");
    const id = await seed();
    const res = await DELETE(delReq(id), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(401);
    expect(await store.getProposal(id)).not.toBeNull();
  });
});
