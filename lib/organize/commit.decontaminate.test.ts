// lib/organize/commit.decontaminate.test.ts
//
// Proves commitProposalCore derives its target type+table from the LOADED
// ontology (via resolveTargetTable), not from hostel literals.
//
// The ontology dir is redirected to seed/book-club. `book` is a valid type in
// that ontology's vocabulary but has NO entry in the generated (hostel-genned)
// TABLES registry — so resolveTargetTable is fail-closed and commit must return
// { status: "invalid_target_type" } rather than reaching SQL.
//
// Heavy transitive deps (next-auth via chat-runtime, db client) are mocked so
// the module imports in a pure vitest environment. The DB is never reached on
// this path — the resolution gate short-circuits before any insert.

import { describe, expect, it, vi } from "vitest";

// getOntologyCached → thin pass-through to loadOntology (avoids next-auth).
vi.mock("@/lib/agent/chat-runtime", async () => {
  const { loadOntology } = await import("@/lib/ontology/load");
  return {
    getOntologyCached: (dir: string) => loadOntology(dir),
  };
});

// Redirect the runtime ontology dir to seed/book-club — the litmus.
vi.mock("@/lib/setup/paths", async () => {
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.resolve(fileURLToPath(import.meta.url), "..");
  return {
    getRuntimeOntologyDir: () => path.resolve(here, "../../seed/book-club"),
  };
});

import { commitProposalCore } from "./commit";
import type { Database } from "../db/client";

// A DB that throws if ever touched — proves the resolution gate short-circuits
// before any query on the fail-closed path.
const explodingDb = new Proxy(
  {},
  {
    get() {
      throw new Error("DB must not be touched on the invalid_target_type path");
    },
  },
) as unknown as Database;

describe("commitProposalCore derives target type+table from the ontology", () => {
  it("returns invalid_target_type for a type valid in the ontology but absent from TABLES (fail-closed)", async () => {
    const result = await commitProposalCore(explodingDb, "steward", "actor-1", {
      inbox_id: "11111111-1111-4111-8111-111111111111",
      target_type: "book", // book-club ontology has `book`; TABLES has no Book
      field_map: {},
      confidence: 1,
      unmapped: [],
      reasoning: "test",
    });
    expect(result.status).toBe("invalid_target_type");
    if (result.status === "invalid_target_type") {
      expect(result.target_type).toBe("book");
    }
  });
});
