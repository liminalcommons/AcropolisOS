// M3.8 step-2: POST /api/proposals/[id]/apply must reject anonymous callers
// BEFORE touching the proposal store or running the migration pipeline.
// Issue #44 (HIGH): schema mutation bypass via unauthenticated apply.
//
// We mock buildChatRuntime to return an anonymous actor and assert the route
// short-circuits with a 401.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: async () => ({
    actor: {
      userId: "anonymous",
      email: "",
      role: "anonymous",
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

// Stub heavy deps — if the route mistakenly reaches them for anonymous calls,
// the test catches the regression via thrown errors.
vi.mock("@/lib/proposals/singleton", () => ({
  getProposalStore: () => {
    throw new Error("getProposalStore must NOT be called for anonymous /api/proposals/[id]/apply");
  },
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    throw new Error("getDb must NOT be called for anonymous /api/proposals/[id]/apply");
  },
}));
vi.mock("@/lib/proposals/apply", () => ({
  applyProposal: () => {
    throw new Error("applyProposal must NOT be called for anonymous /api/proposals/[id]/apply");
  },
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

import { POST } from "./route";

describe("POST /api/proposals/[id]/apply — anonymous rejection (M3.8 #44)", () => {
  it("returns 401 without touching the proposal store or migration pipeline", async () => {
    const req = new Request("http://localhost/api/proposals/test-id/apply", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ id: "test-id" }) });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("unauthorized");
  });
});
