// Happy-path steward tests for POST /api/proposals/[id]/apply.
// Auth and forbidden-role paths live in route.unauth.test.ts and
// route.member.test.ts respectively (M3.8 #44/#46).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryProposalDraftStore } from "@/lib/proposals/store";

const store = new InMemoryProposalDraftStore();

// M3.8: mock the entire chat-runtime so next-auth's next/server CJS import
// never materialises in vitest. Returns a steward actor so the route proceeds
// past the auth/role gates.
vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: async () => ({
    actor: {
      userId: "steward-1",
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
  }),
  isAnonymous: (actor: { role?: string } | null) =>
    actor === null || actor.role === "anonymous",
}));

vi.mock("@/lib/proposals/singleton", () => ({
  getProposalStore: () => store,
}));

// Stub the DB — not needed for the happy-path in-memory store tests.
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({}),
}));

// Stub applyProposal to return a successful result without touching the FS,
// running codegen, or hitting Postgres. The store mutation (setStatus →
// "approved") is what these tests exercise.
vi.mock("@/lib/proposals/apply", () => ({
  applyProposal: async () => ({
    ok: true,
    proposalId: "stubbed",
    migrationTag: "0000_stub",
    inboxRowsMigrated: 0,
    commitHint: [],
  }),
}));

vi.mock("@/lib/proposals/adapters/yaml-writer", () => ({
  FsYamlWriter: class {},
}));
vi.mock("@/lib/proposals/adapters/codegen", () => ({
  GeneratedFilesCodegen: class {},
}));
vi.mock("@/lib/proposals/adapters/runtime", () => ({
  DiffMigrationRunner: class {},
  PgAuditStore: class {},
  PgInboxMigrator: class {},
  PgProposalStatusStore: class {},
  PgTransactionRunner: class {},
}));
vi.mock("@/lib/views/registry-pg", () => ({
  PgApprovedViewsRegistry: class {},
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

describe("POST /api/proposals/[id]/apply", () => {
  beforeEach(async () => {
    const all = await store.listProposals();
    for (const p of all) {
      await store.setStatus(p.id, "rejected");
    }
  });

  it("marks the proposal approved", async () => {
    const id = await seed();
    const res = await POST(
      new Request(`http://localhost/api/proposals/${id}/apply`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const fetched = await store.getProposal(id);
    expect(fetched?.status).toBe("approved");
  });

  it("returns 404 for unknown id", async () => {
    const res = await POST(
      new Request("http://localhost/api/proposals/ghost/apply", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "ghost" }) },
    );
    expect(res.status).toBe(404);
  });
});
