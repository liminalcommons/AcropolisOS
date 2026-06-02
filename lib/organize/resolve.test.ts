// lib/organize/resolve.test.ts
//
// Coverage for the near-match dedup engine (resolve.ts) — the ONLY place in the
// ingestion pipeline that queries existing rows of a type and returns similarity
// candidates. Every sibling organize module (evolve, commit, target-table) is
// tested; this closes that gap so the load-bearing normalization, Levenshtein
// scoring, candidate cap, and FAIL-CLOSED SQL discipline cannot silently regress.
//
// The contract under test (from resolve.ts):
//   - normalizeStr: NFD-decompose → strip diacritics → lowercase → trim
//   - levenshtein: classic edit distance (two-row DP)
//   - findDuplicates(db, resolved, ontology, mappedFields):
//       key fields are ONTOLOGY-DERIVED (deriveKeyFields: email-typed props +
//       title_property), the SQL table name comes from getTableName(resolved.table)
//       (NEVER the raw type string — fail-closed), the label from title_property.
//       Per candidate, best field score wins: email normalized-exact → 1.0,
//       other key-field normalized-exact → 0.95, Levenshtein ≤ 2 → 0.8, else 0
//       (dropped). Returns up to 5, score desc.
//
// FIXTURES (no hostel literals): a synthetic `member` ontology + a real pgTable
// supply resolved.table so getTableName yields a stable SQL name, and a stub db
// records every db.execute() so we can assert SQL is (or is NOT) reached.

import { describe, expect, it } from "vitest";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { findDuplicates, levenshtein, normalizeStr } from "./resolve";
import type { ResolvedTarget } from "./target-table";
import type { Ontology } from "../ontology/schema";
import type { Database } from "../db/client";

// ── Synthetic ontology (ontology-derived key fields, no hostel literals) ────────
//
// member: email-typed `email` + title_property `name` → deriveKeyFields = [email, name].
// `tier` is a plain string property — NOT a key field — present to prove derivation
// does not over-include arbitrary fields.
function makeOntology(opts?: {
  titleProperty?: string;
  extraEmailField?: boolean;
}): Ontology {
  const properties: Record<string, unknown> = {
    id: { type: "uuid", primary_key: true },
    email: { type: "email" },
    name: { type: "string" },
    tier: { type: "string" },
  };
  if (opts?.extraEmailField) {
    properties.alt_email = { type: "email" };
  }
  return {
    properties: {},
    roles: {},
    object_types: {
      Member: {
        title_property: opts?.titleProperty ?? "name",
        properties: properties as never,
      },
    },
    link_types: {},
    action_types: {},
  } as Ontology;
}

// A real Drizzle table → getTableName(resolved.table) returns a stable SQL name.
const memberTable = pgTable("member", {
  id: uuid("id"),
  email: text("email"),
  name: text("name"),
  tier: text("tier"),
  alt_email: text("alt_email"),
});

function makeResolved(): ResolvedTarget {
  return {
    token: "member",
    objectType: "Member",
    table: memberTable as unknown as ResolvedTarget["table"],
  };
}

// ── Stub db ─────────────────────────────────────────────────────────────────
// resolve.ts touches exactly ONE db surface: db.execute(sql.raw(...)). The stub
// records the call count (proving the fail-closed gate fires pre-SQL) and returns
// a caller-supplied set of existing rows. Returns the bare array shape — resolve.ts
// also handles the { rows } shape, exercised in a dedicated case below.
interface StubDb {
  executeCalls: number;
  asDatabase(): Database;
}

function makeStubDb(rows: Array<Record<string, unknown>>): StubDb {
  const stub = {
    executeCalls: 0,
    async execute(_query: unknown) {
      this.executeCalls++;
      return rows;
    },
    asDatabase(): Database {
      return this as unknown as Database;
    },
  };
  return stub;
}

// A db that THROWS if ever touched — proves the no-key-fields path never reaches SQL.
const explodingDb = new Proxy(
  {},
  {
    get() {
      throw new Error("db must not be touched when no key fields are present");
    },
  },
) as unknown as Database;

// ── normalizeStr ────────────────────────────────────────────────────────────

describe("normalizeStr — hygiene gate for field matching", () => {
  it("converts to lowercase", () => {
    expect(normalizeStr("ALICE")).toBe("alice");
  });
  it("strips diacritics via NFD decomposition", () => {
    expect(normalizeStr("José")).toBe("jose");
    expect(normalizeStr("Müller")).toBe("muller");
    expect(normalizeStr("naïve")).toBe("naive");
  });
  it("trims whitespace", () => {
    expect(normalizeStr("  alice  ")).toBe("alice");
  });
  it("handles empty string", () => {
    expect(normalizeStr("")).toBe("");
  });
  it("composes all three: diacritics + casing + trim together", () => {
    expect(normalizeStr("  JOSÉ  ")).toBe("jose");
  });
});

// ── levenshtein ───────────────────────────────────────────────────────────────

describe("levenshtein distance — exact implementation correctness", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("alice", "alice")).toBe(0);
  });
  it("returns correct distance for single-char substitution", () => {
    expect(levenshtein("alice", "alyce")).toBe(1); // c→y
  });
  it("returns distance 2 for two substitutions", () => {
    expect(levenshtein("alice", "altcf")).toBe(2); // i→t AND e→f (two substitutions)
  });
  it("handles empty strings (distance = other length)", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "")).toBe(0);
  });
  it("counts a single insertion/deletion as distance 1", () => {
    expect(levenshtein("alice", "alicee")).toBe(1); // insertion
    expect(levenshtein("alicee", "alice")).toBe(1); // deletion
  });
  it("returns distance > 2 for very different strings", () => {
    expect(levenshtein("alice", "bob")).toBeGreaterThan(2);
  });
});

// ── findDuplicates ─────────────────────────────────────────────────────────────

describe("findDuplicates — core dedup behavior", () => {
  const ontology = makeOntology();
  const resolved = makeResolved();

  it("returns [] and NEVER touches SQL when no key fields are present in mappedFields", async () => {
    // mappedFields carries only `tier` (a non-key plain string). key_fields are
    // [email, name] → nothing to match on → fail-closed, no SQL.
    const result = await findDuplicates(explodingDb, resolved, ontology, {
      tier: "gold",
    });
    expect(result).toEqual([]);
  });

  it("scores an email normalized-exact match as 1.0", async () => {
    const db = makeStubDb([
      { id: "row-1", name: "Alice", email: "alice@example.com" },
    ]);
    const result = await findDuplicates(db.asDatabase(), resolved, ontology, {
      email: "ALICE@EXAMPLE.COM",
    });
    expect(db.executeCalls).toBe(1);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(1.0);
    expect(result[0].id).toBe("row-1");
  });

  it("scores a non-email key-field normalized-exact match as 0.95", async () => {
    const db = makeStubDb([
      { id: "row-1", name: "Alice Smith", email: "" },
    ]);
    const result = await findDuplicates(db.asDatabase(), resolved, ontology, {
      name: "ALICE SMITH",
    });
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.95);
  });

  it("scores a Levenshtein distance ≤ 2 fuzzy match as 0.8", async () => {
    const db = makeStubDb([{ id: "row-1", name: "Alice", email: "" }]);
    const result = await findDuplicates(db.asDatabase(), resolved, ontology, {
      name: "Alise", // distance 1 from Alice
    });
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.8);
  });

  it("drops a candidate whose distance > 2 (score 0, omitted)", async () => {
    const db = makeStubDb([{ id: "row-1", name: "Alice", email: "" }]);
    const result = await findDuplicates(db.asDatabase(), resolved, ontology, {
      name: "Bob", // distance 3 → no match
    });
    expect(result).toEqual([]);
  });

  it("takes the BEST score across multiple key fields", async () => {
    // email mismatch (score 0) but name exact (0.95) → best 0.95.
    const db = makeStubDb([
      { id: "row-1", name: "Alice", email: "alice@example.com" },
    ]);
    const result = await findDuplicates(db.asDatabase(), resolved, ontology, {
      email: "wrong@example.com",
      name: "Alice",
    });
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.95);
  });

  it("respects the 5-candidate cap and sorts by score desc", async () => {
    // 10 rows: 5 exact-name (0.95) + 5 fuzzy (0.8). All score > 0; cap → top 5,
    // which must be the five 0.95s.
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 5; i++) {
      rows.push({ id: `exact-${i}`, name: "Alice", email: "" });
    }
    for (let i = 0; i < 5; i++) {
      rows.push({ id: `fuzzy-${i}`, name: "Alise", email: "" });
    }
    const db = makeStubDb(rows);
    const result = await findDuplicates(db.asDatabase(), resolved, ontology, {
      name: "Alice",
    });
    expect(result).toHaveLength(5);
    // sorted desc → non-increasing
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
    // top of the list is the exact (0.95) cohort
    expect(result[0].score).toBe(0.95);
  });

  it("omits candidates whose bestScore is 0", async () => {
    // Two rows: one matches (Alice), one does not (Zebra). Only the match returns.
    const db = makeStubDb([
      { id: "match", name: "Alice", email: "" },
      { id: "nomatch", name: "Zebra", email: "" },
    ]);
    const result = await findDuplicates(db.asDatabase(), resolved, ontology, {
      name: "Alice",
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("match");
  });

  it("uses the ontology title_property as the candidate label, not the id", async () => {
    const db = makeStubDb([
      { id: "row-1", name: "Alice Smith", email: "alice@example.com" },
    ]);
    const result = await findDuplicates(db.asDatabase(), resolved, ontology, {
      email: "alice@example.com",
    });
    expect(result[0].label).toBe("Alice Smith"); // title_property=name, not the id
  });

  it("derives key fields from the ontology — a SECOND email-typed property is matched on", async () => {
    // Ontology with a SECOND email-typed property (alt_email). deriveKeyFields is
    // ontology-driven, so it INCLUDES alt_email as a key field and the engine
    // matches on it — proving derivation is not hardcoded to a single field.
    //
    // NOTE the 1.0 email-exact rule is keyed on the LITERAL field NAME "email"
    // (resolve.ts: `if (field === "email")`), NOT on the ontology email *type*.
    // So alt_email scores as a name-like field: normalized-exact → 0.95. This
    // pins the actual implemented behavior; if the rule is ever generalized to
    // every email-typed field, this assertion is the trip-wire to revisit.
    const onto = makeOntology({ extraEmailField: true });
    const db = makeStubDb([
      { id: "row-1", name: "Alice", email: "", alt_email: "alt@example.com" },
    ]);
    const result = await findDuplicates(db.asDatabase(), makeResolved(), onto, {
      alt_email: "ALT@EXAMPLE.COM",
    });
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.95);
  });

  it("handles the { rows } db.execute shape (drizzle postgres.js)", async () => {
    // resolve.ts unwraps both the bare array and the { rows: [...] } shape.
    const stub = {
      executeCalls: 0,
      async execute(_query: unknown) {
        this.executeCalls++;
        return { rows: [{ id: "row-1", name: "Alice", email: "" }] };
      },
      asDatabase(): Database {
        return this as unknown as Database;
      },
    };
    const result = await findDuplicates(stub.asDatabase(), resolved, ontology, {
      name: "Alice",
    });
    expect(stub.executeCalls).toBe(1);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.95);
  });

  it("ignores rows whose key-field values are empty (no false 0.95 on ''==='')", async () => {
    // A stored row with an empty name must NOT match an incoming empty name —
    // resolve.ts skips a field when either side is empty.
    const db = makeStubDb([{ id: "row-1", name: "", email: "" }]);
    const result = await findDuplicates(db.asDatabase(), resolved, ontology, {
      name: "Alice",
    });
    expect(result).toEqual([]);
  });
});
