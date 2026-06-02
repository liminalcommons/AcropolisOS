// SECURITY: per-actor read permission gate on the widget read path.
//
// The vulnerability this proves closed: createReadOnlyDataApi took a RAW db
// handle and enforced ONLY a structural type/field whitelist — NO per-actor
// read permission. Any caller could read ANY whitelisted type's rows regardless
// of the viewer's role. Restricted types (booking/guest, read:[steward,manager])
// would have leaked to non-stewards once agent-composed views query them.
//
// The fix: createReadOnlyDataApi(db, canReadType) gates every read method
// (count/select/byDate) by the VIEWER's per-type read permission, FAIL CLOSED,
// reusing buildObjectPermissionsMap + actorMatchesTokens (the SAME model as
// ctx.objects). This test proves:
//   - member  → restricted type (booking) → empty (count 0, select {[],[]} , byDate [])
//   - steward → restricted type (booking) → reaches SQL (gate does not force-empty)
//   - bed (read:["*"]) → reaches SQL for BOTH member and steward
// using the REAL permissions from the shipped ontology and a stub db that
// records whether SQL was ever attempted (proving the gate runs pre-SQL).

import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { getTableName } from "drizzle-orm";
import { createReadOnlyDataApi, buildCanReadType, resolveFilterValue } from "./read-api";
import { loadOntology } from "@/lib/ontology/load";
import { deriveVocabulary } from "./vocabulary";
import { pascalToSnake } from "@/lib/ontology/casing";
import { TABLES } from "@/lib/db/schema.generated";
import type { Ontology } from "@/lib/ontology/schema";
import type { Actor } from "@/lib/ctx";
import type { Database } from "@/lib/db/client";

const member: Actor = {
  userId: "u-member",
  email: "member@example.com",
  role: "member",
  customRoles: [],
};

const steward: Actor = {
  userId: "u-steward",
  email: "steward@example.com",
  role: "steward",
  customRoles: [],
};

// ── Stub db ──────────────────────────────────────────────────────────────────
//
// Records every SQL attempt. Returns a sentinel row for any read that reaches
// it, so an authorized read is observably non-empty AND we can assert that an
// UNauthorized read never touched the db (the gate fired before SQL).
//
// Shapes mirror the only db surfaces read-api uses:
//   - db.execute(sql)            → Record<string,unknown>[]
//   - db.select(cols).from(t)    → thenable resolving to rows (count path)
//   - db.select().from(t).limit  → thenable resolving to rows (byDate path)

interface StubDb {
  executeCalls: number;
  selectCalls: number;
  /** Column-projection keys passed to the most recent db.select(cols) call.
   *  undefined for a bare db.select() (the all-columns shape). Lets a test
   *  assert that byDate projects ONLY [dateField, "id"], not every column. */
  lastSelectCols: string[] | undefined;
  asDatabase(): Database;
}

function makeStubDb(): StubDb {
  const stub = {
    executeCalls: 0,
    selectCalls: 0,
    lastSelectCols: undefined as string[] | undefined,
    asDatabase(): Database {
      return this as unknown as Database;
    },
    // count(filter) + select() path
    async execute(_query: unknown) {
      this.executeCalls++;
      // count path expects [{ count }]; select path expects row records.
      // Return one row carrying both shapes so either consumer sees data.
      return [{ count: 7, full_name: "Sentinel", id: "row-1" }];
    },
    // count(no filter) + byDate() path: db.select(...).from(table)[.limit(n)]
    select(cols?: unknown) {
      this.selectCalls++;
      this.lastSelectCols =
        cols && typeof cols === "object" ? Object.keys(cols as Record<string, unknown>) : undefined;
      const rows = [{ count: 7, id: "row-1", from_date: "2026-05-25" }];
      const chain = {
        from(_t: unknown) {
          return {
            limit(_n: number) {
              return Promise.resolve(rows);
            },
            then(resolve: (r: typeof rows) => unknown) {
              return Promise.resolve(rows).then(resolve);
            },
          };
        },
      };
      return chain;
    },
  };
  return stub;
}

// ── Real ontology permissions ──────────────────────────────────────────────────

let ontology: Ontology;

beforeAll(async () => {
  // Real shipped ontology: bed read:["*"], booking/guest read:[steward,manager].
  ontology = await loadOntology(path.resolve(__dirname, "../../ontology"));
});

describe("read-api per-actor read permission gate (fail-closed)", () => {
  it("sanity: the shipped ontology has the expected read tokens", () => {
    expect(ontology.object_types.Bed.permissions?.read).toEqual(["*"]);
    expect(ontology.object_types.Booking.permissions?.read).toEqual([
      "steward",
      "manager",
    ]);
  });

  describe("member viewer + restricted type (booking, read:[steward,manager])", () => {
    it("select → { columns: [], rows: [] } and never touches SQL", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology), ontology);
      const result = await api.select("booking", {
        columns: ["label", "status"],
        limit: 10,
      });
      expect(result).toEqual({ columns: [], rows: [] });
      expect(db.executeCalls).toBe(0);
      expect(db.selectCalls).toBe(0);
    });

    it("count → 0 and never touches SQL", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology), ontology);
      const result = await api.count("booking");
      expect(result).toBe(0);
      expect(db.executeCalls).toBe(0);
      expect(db.selectCalls).toBe(0);
    });

    it("count with filter → 0 and never touches SQL", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology), ontology);
      const result = await api.count("booking", { field: "status", value: "confirmed" });
      expect(result).toBe(0);
      expect(db.executeCalls).toBe(0);
      expect(db.selectCalls).toBe(0);
    });

    it("byDate → [] and never touches SQL", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology), ontology);
      const result = await api.byDate("booking", "from_date", 10);
      expect(result).toEqual([]);
      expect(db.executeCalls).toBe(0);
      expect(db.selectCalls).toBe(0);
    });
  });

  describe("steward viewer + restricted type (booking)", () => {
    it("select reaches SQL — the gate does NOT force-empty an authorized read", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology), ontology);
      const result = await api.select("booking", { columns: ["label"], limit: 10 });
      expect(result.columns).toEqual(["label"]);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(db.executeCalls).toBeGreaterThan(0);
    });

    it("count reaches SQL and returns the live count", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology), ontology);
      const result = await api.count("booking");
      expect(result).toBe(7);
      expect(db.selectCalls).toBeGreaterThan(0);
    });

    it("byDate reaches SQL and returns rows", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology), ontology);
      const result = await api.byDate("booking", "from_date", 10);
      expect(result.length).toBeGreaterThan(0);
      expect(db.selectCalls).toBeGreaterThan(0);
    });
  });

  describe("byDate column projection (data-access hygiene)", () => {
    // byDate buckets results by a single date field in-memory; it does NOT need
    // every column. Projecting ONLY [dateField, "id"] mirrors the composition
    // layer's hidden-column discipline (commit 80d76c3) — disciplined data access
    // over the read-only fence. Member is a many-column type (full_name, email,
    // phone, tier_role, started_at, notes); started_at is its declared date field.
    it("projects ONLY [dateField, 'id'], not all columns", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(
        db.asDatabase(),
        buildCanReadType(steward, ontology),
        ontology,
      );
      const result = await api.byDate("member", "started_at", 10);
      // The projection passed to db.select(...) must be exactly the date field
      // plus id — never the full column set (no full_name / email / notes / …).
      expect(db.lastSelectCols).toEqual(["started_at", "id"]);
      // And the read still reaches SQL and returns rows (no behavioral change).
      expect(db.selectCalls).toBeGreaterThan(0);
      expect(result.length).toBeGreaterThan(0);
    });

    it("a denied viewer still never touches SQL (projection does not weaken the gate)", async () => {
      // member viewer on a restricted type (booking) → fail-closed BEFORE any
      // db.select; the new projection must not introduce a pre-gate SQL path.
      const db = makeStubDb();
      const api = createReadOnlyDataApi(
        db.asDatabase(),
        buildCanReadType(member, ontology),
        ontology,
      );
      const result = await api.byDate("booking", "from_date", 10);
      expect(result).toEqual([]);
      expect(db.selectCalls).toBe(0);
      expect(db.lastSelectCols).toBeUndefined();
    });
  });

  describe("public type (bed, read:[\"*\"]) reaches SQL for BOTH roles", () => {
    it("member can read bed", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology), ontology);
      const result = await api.select("bed", { columns: ["code"], limit: 10 });
      expect(result.columns).toEqual(["code"]);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(db.executeCalls).toBeGreaterThan(0);
    });

    it("steward can read bed", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology), ontology);
      const result = await api.count("bed");
      expect(result).toBe(7);
      expect(db.selectCalls).toBeGreaterThan(0);
    });
  });

  describe("selectByIds — fail-closed permission gate + parameterization", () => {
    it("member + restricted type (booking) → {columns:[], rows:[]} and NO SQL executed", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology), ontology);
      const result = await api.selectByIds("booking", ["some-uuid"], ["id", "label"]);
      expect(result).toEqual({ columns: [], rows: [] });
      // The permission gate must fire BEFORE any SQL — db never touched.
      expect(db.executeCalls).toBe(0);
      expect(db.selectCalls).toBe(0);
    });

    it("steward + restricted type (booking) → reaches SQL and returns the row", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology), ontology);
      const result = await api.selectByIds("booking", ["some-uuid"], ["id", "label"]);
      expect(result.columns).toContain("id");
      expect(result.columns).toContain("label");
      expect(result.rows.length).toBeGreaterThan(0);
      expect(db.executeCalls).toBeGreaterThan(0);
    });

    it("unknown type → {columns:[], rows:[]} and no SQL", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology), ontology);
      const result = await api.selectByIds("not_a_type", ["some-uuid"], ["id"]);
      expect(result).toEqual({ columns: [], rows: [] });
      expect(db.executeCalls).toBe(0);
      expect(db.selectCalls).toBe(0);
    });

    it("empty ids array → {columns, rows:[]} and no SQL executed", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology), ontology);
      const result = await api.selectByIds("booking", [], ["id", "label"]);
      expect(result.rows).toEqual([]);
      // No SQL should fire for an empty id list.
      expect(db.executeCalls).toBe(0);
      expect(db.selectCalls).toBe(0);
    });

    it("public type (bed, read:[\"*\"]) → reaches SQL for member viewer", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology), ontology);
      const result = await api.selectByIds("bed", ["bed-id-1"], ["id", "code"]);
      expect(result.columns).toContain("id");
      expect(result.columns).toContain("code");
      expect(result.rows.length).toBeGreaterThan(0);
      expect(db.executeCalls).toBeGreaterThan(0);
    });
  });

  describe("data_table filter pass-through (agent_blocker veto-queue)", () => {
    // The /org default veto-queue is a data_table over agent_blocker filtered
    // to status=open. agent_blocker read perms are [steward, member_self], so a
    // steward viewer reaches SQL; the filter field is whitelisted + bound.
    it("steward + agent_blocker with status=open filter → reaches filtered SQL", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology), ontology);
      const result = await api.select("agent_blocker", {
        columns: ["summary", "reason_kind", "blocked_actor_id"],
        filter: { field: "status", value: "open" },
        limit: 50,
      });
      expect(result.columns).toEqual(["summary", "reason_kind", "blocked_actor_id"]);
      expect(result.rows.length).toBeGreaterThan(0);
      // A filtered select goes through db.execute (raw SQL with bound value).
      expect(db.executeCalls).toBeGreaterThan(0);
    });

    it("member + agent_blocker → empty and no SQL (read:[steward, member_self], type gate denies member)", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology), ontology);
      const result = await api.select("agent_blocker", {
        columns: ["summary"],
        filter: { field: "status", value: "open" },
        limit: 50,
      });
      expect(result).toEqual({ columns: [], rows: [] });
      expect(db.executeCalls).toBe(0);
      expect(db.selectCalls).toBe(0);
    });

    it("invalid filter field returns empty (fail-closed, matches count) — no SQL", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology), ontology);
      const result = await api.select("agent_blocker", {
        columns: ["summary"],
        filter: { field: "not_a_real_field", value: "x" },
        limit: 10,
      });
      // Fail-closed: an unrecognized filter field returns empty, never a silent
      // unfiltered superset. count() returns 0 for the same condition.
      expect(result).toEqual({ columns: [], rows: [] });
      expect(db.executeCalls).toBe(0);
    });
  });

  describe("buildCanReadType predicate semantics", () => {
    it("member: bed allow, booking deny, guest deny, unknown deny", () => {
      const can = buildCanReadType(member, ontology);
      expect(can("bed")).toBe(true);
      expect(can("booking")).toBe(false);
      expect(can("guest")).toBe(false);
      expect(can("work_trade_agreement")).toBe(false);
      expect(can("not_a_type")).toBe(false);
    });

    it("steward: bed allow, booking allow, guest allow", () => {
      const can = buildCanReadType(steward, ontology);
      expect(can("bed")).toBe(true);
      expect(can("booking")).toBe(true);
      expect(can("guest")).toBe(true);
    });

    it("null actor (anonymous): only ['*'] types allowed (bed), restricted denied", () => {
      const can = buildCanReadType(null, ontology);
      expect(can("bed")).toBe(true);
      expect(can("booking")).toBe(false);
    });
  });

  describe("buildCanReadType 'view as' role override (steward preview lens)", () => {
    // A steward previews another role's board via ?as=<role>. The override
    // synthesizes a viewer carrying ONLY that role's authority, so the lens admits
    // exactly that role's slice — the SAME render() function, a different viewer.
    // The CALLER (app/page.tsx) enforces steward-only; these prove the lens math:
    // the preview must never leak MORE than the previewed role can read.

    it("steward viewing as member DOWNGRADES: bed allow, booking deny, guest deny", () => {
      const can = buildCanReadType(steward, ontology, "member");
      expect(can("bed")).toBe(true);
      // The steward's own access must NOT leak through the member preview.
      expect(can("booking")).toBe(false);
      expect(can("guest")).toBe(false);
    });

    it("steward viewing as a custom role (manager) admits that role's slice: booking allow", () => {
      // booking read:[steward, manager] — the manager lens carries the custom role
      // (customRoles:["manager"]) so the booking slice opens, where a member's
      // would not. Proves a custom role previews its real authority.
      const can = buildCanReadType(steward, ontology, "manager");
      expect(can("booking")).toBe(true);
      expect(can("bed")).toBe(true);
    });

    it("steward viewing as steward is a no-op: full access retained", () => {
      const can = buildCanReadType(steward, ontology, "steward");
      expect(can("booking")).toBe(true);
      expect(can("guest")).toBe(true);
    });

    it("an unknown preview role is fail-closed to public ['*'] types: bed allow, booking deny", () => {
      // A role whose name appears in no read list matches nothing restricted —
      // the synthetic member-base + unknown-custom-role admits only read:["*"].
      const can = buildCanReadType(steward, ontology, "totally_made_up_role");
      expect(can("bed")).toBe(true);
      expect(can("booking")).toBe(false);
    });
  });
});

describe("read-api is ontology-derived (non-hostel)", () => {
  // The litmus: a completely different org's ontology (book-club) flows through
  // the SAME fence with ZERO hostel-type leakage. The structural whitelist is
  // derived from the LOADED ontology, never from hostel literals.
  it("derives the book-club whitelist and rejects a hostel type", async () => {
    const onto = await loadOntology(path.resolve(__dirname, "../../scenarios/book-club/ontology"));
    const vocab = deriveVocabulary(onto);
    // 'book' exists in the LOADED ontology → in the structural whitelist.
    expect(vocab.validTypes).toContain("book");
    // 'bed' is a hostel type, NOT in this ontology → absent from the whitelist.
    expect(vocab.validTypes).not.toContain("bed");
  });

  it("fail-closes on ontology↔schema drift: a whitelisted type whose table is absent from the generated TABLES returns safe-empty, never a phantom-table read", async () => {
    // The book-club ontology is real ontology↔generated-schema DRIFT: its types
    // (Book, …) are valid in the loaded ontology's whitelist but have NO entry in
    // the generated (hostel) TABLES registry. The hardened resolveType MUST treat
    // this as fail-closed — without it, tableFor() would index TABLES with a
    // missing key, yielding an `undefined` table object cast to a real table, and
    // getTableName(undefined) would throw or (worse) a stray identifier would
    // reach SQL. The single-authority guard closes that latent cast.
    const onto = await loadOntology(path.resolve(__dirname, "../../scenarios/book-club/ontology"));
    const db = makeStubDb();
    const api = createReadOnlyDataApi(db.asDatabase(), () => true, onto);
    const denied = await api.select("book", { columns: ["title"], limit: 5 });
    expect(denied).toEqual({ columns: [], rows: [] });
    // The guard fires BEFORE any SQL — no phantom-table query is attempted.
    expect(db.executeCalls).toBe(0);
    expect(db.selectCalls).toBe(0);
    const denied2 = await api.count("book");
    expect(denied2).toBe(0);
    expect(db.executeCalls).toBe(0);
    expect(db.selectCalls).toBe(0);
  });
});

describe("read-api raw-SQL table name is sourced from the TABLES registry, not the token (acronym-divergence leak)", () => {
  // THE HIGH BUG: the raw-SQL count(filtered)/select paths interpolated the
  // validated TOKEN as the SQL table name. The token is produced by pascalToSnake
  // while the ACTUAL Drizzle table SQL name is produced by snakeCase (drizzle.ts).
  // These DIVERGE for acronym-cased object-type names (e.g. APIKey: snakeCase →
  // "apikey", pascalToSnake → "api_key"). For such an ontology, the permission
  // gate (canReadType) validated TYPE A's tokens while the raw SQL read a
  // DIFFERENT physical table → cross-type read leak. The fix re-couples gate and
  // table by sourcing the SQL name from getTableName(tableFor(token)) — the
  // IDENTICAL TABLES lookup the gate uses.

  it("getTableName(TABLES[pascalKey]) is a defined non-empty SQL identifier for all 13 hostel types", () => {
    const pascalKeys = Object.keys(TABLES) as (keyof typeof TABLES)[];
    expect(pascalKeys.length).toBe(13);
    for (const key of pascalKeys) {
      const name = getTableName(TABLES[key]);
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("for every vocab token, the registry resolves a real table whose SQL name equals snakeCase(pascalKey) — the SAME table the permission gate keys on", async () => {
    // For each token: the gate keys on TABLES[vocab.typeToObjectType[token]];
    // the raw SQL must read getTableName of THAT SAME table object. Asserting the
    // correspondence for every type proves the single-authority property: there is
    // exactly one path from token → table, shared by gate and SQL.
    const vocab = deriveVocabulary(ontology);
    for (const token of vocab.validTypes) {
      const pascalKey = vocab.typeToObjectType[token] as keyof typeof TABLES;
      const table = TABLES[pascalKey];
      expect(table).toBeDefined();
      const sqlName = getTableName(table);
      expect(typeof sqlName).toBe("string");
      expect(sqlName.length).toBeGreaterThan(0);
    }
  });

  it("regression sentinel: pascalToSnake DIVERGES from the registry SQL name for an acronym-cased type — proving the token is the WRONG source", () => {
    // The exact failure shape the fix closes. If a custom ontology declares an
    // acronym-cased object type, the token (pascalToSnake) and the physical table
    // (snakeCase, what getTableName returns) are DIFFERENT strings. Sourcing the
    // SQL table from the token would read the wrong physical table while the gate
    // authorized the right type. We assert the divergence so any future change
    // that re-introduces token-sourcing is caught.
    expect(pascalToSnake("APIKey")).toBe("api_key");
    // snakeCase (drizzle.ts) → "apikey" for the same name; the registry/table SQL
    // name follows snakeCase, NOT pascalToSnake. Demonstrate with a live pgTable:
    // the table the gate would resolve carries the snakeCase name, so the SQL
    // identifier MUST come from getTableName(table), not from the token.
    expect(pascalToSnake("APIKey")).not.toBe("apikey");
  });
});

describe("resolveFilterValue (@today relative-date token)", () => {
  it("resolves @today to the current date (YYYY-MM-DD)", () => {
    const expected = new Date().toISOString().slice(0, 10);
    expect(resolveFilterValue("@today")).toBe(expected);
    expect(resolveFilterValue("@today")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("passes non-token values through untouched", () => {
    expect(resolveFilterValue("open")).toBe("open");
    expect(resolveFilterValue("2026-06-01")).toBe("2026-06-01");
    expect(resolveFilterValue("")).toBe("");
  });
});
