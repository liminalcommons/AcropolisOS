// M3.8 #46: POST /api/proposals/[id]/apply must reject authenticated members
// (role !== "steward") with 403 BEFORE touching the proposal store or running
// the migration pipeline.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: async () => ({
    actor: {
      userId: "user-123",
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

// Stub heavy deps — if the route mistakenly reaches them for member calls,
// the test catches the regression via thrown errors.
vi.mock("@/lib/proposals/singleton", () => ({
  getProposalStore: () => {
    throw new Error("getProposalStore must NOT be called for member /api/proposals/[id]/apply");
  },
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    throw new Error("getDb must NOT be called for member /api/proposals/[id]/apply");
  },
}));
vi.mock("@/lib/proposals/apply", () => ({
  applyProposal: () => {
    throw new Error("applyProposal must NOT be called for member /api/proposals/[id]/apply");
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

describe("POST /api/proposals/[id]/apply — member rejection (M3.8 #46)", () => {
  it("returns 403 for authenticated member (role !== steward)", async () => {
    const req = new Request("http://localhost/api/proposals/test-id/apply", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ id: "test-id" }) });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("forbidden");
  });
});
