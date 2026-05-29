// app/api/organize/classify/route.derive.test.ts
//
// Tests that buildTargetVocab() derives types/fields from the loaded ontology
// (not hostel hardcoded literals). The ontology dir is redirected to
// seed/book-club so we can assert book-club types appear and hostel types don't.
//
// Heavy next-auth / db transitive deps are mocked so the route module can be
// imported in a pure vitest environment.

import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Mock chat-runtime to avoid transitive next-auth / next/server imports.
// The exported getOntologyCached is re-implemented as a thin pass-through to
// loadOntology so buildTargetVocab still resolves the (mocked) ontology dir.
vi.mock("@/lib/agent/chat-runtime", async () => {
  const { loadOntology } = await import("@/lib/ontology/load");
  return {
    buildChatRuntime: vi.fn(),
    isAnonymous: vi.fn(() => false),
    getOntologyCached: (dir: string) => loadOntology(dir),
    ANONYMOUS_ACTOR: { userId: "anonymous", email: "", role: "anonymous", customRoles: [] },
  };
});

// Mock db/client and schema so the route module imports cleanly.
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/db/schema", () => ({ raw_inbox: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("@/lib/agent/mastra", () => ({ buildLanguageModel: vi.fn() }));
vi.mock("@/lib/agent/extract-json", () => ({ extractJson: vi.fn() }));
vi.mock("ai", () => ({ generateText: vi.fn() }));

// Redirect the ontology dir to seed/book-club — the litmus.
// Use import.meta to compute the path inline (vi.mock factories are hoisted,
// so closures over module-level consts would see undefined).
vi.mock("@/lib/setup/paths", async () => {
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  // __dirname equivalent in ESM context used by vite/vitest transforms
  const here = path.resolve(
    fileURLToPath(import.meta.url),
    "..",
  );
  return {
    getRuntimeOntologyDir: () =>
      path.resolve(here, "../../../../seed/book-club"),
    getEnvFile: () => "",
    getSeedRoot: () => "",
    isSeedName: () => false,
    SEED_NAMES: [],
  };
});

import { buildTargetVocab } from "@/app/api/organize/classify/route";

describe("classify route derives its enum from the loaded ontology", () => {
  it("uses book-club types, not hostel literals", async () => {
    const { types, fields } = await buildTargetVocab();
    expect(types).toContain("book");
    expect(types).not.toContain("bed");
    expect(fields["book"]).toContain("title");
  });
});
