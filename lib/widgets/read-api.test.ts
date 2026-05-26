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
import { createReadOnlyDataApi, buildCanReadType } from "./read-api";
import { loadOntology } from "@/lib/ontology/load";
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
  asDatabase(): Database;
}

function makeStubDb(): StubDb {
  const stub = {
    executeCalls: 0,
    selectCalls: 0,
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
    select(_cols?: unknown) {
      this.selectCalls++;
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
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology));
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
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology));
      const result = await api.count("booking");
      expect(result).toBe(0);
      expect(db.executeCalls).toBe(0);
      expect(db.selectCalls).toBe(0);
    });

    it("count with filter → 0 and never touches SQL", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology));
      const result = await api.count("booking", { field: "status", value: "confirmed" });
      expect(result).toBe(0);
      expect(db.executeCalls).toBe(0);
      expect(db.selectCalls).toBe(0);
    });

    it("byDate → [] and never touches SQL", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology));
      const result = await api.byDate("booking", "from_date", 10);
      expect(result).toEqual([]);
      expect(db.executeCalls).toBe(0);
      expect(db.selectCalls).toBe(0);
    });
  });

  describe("steward viewer + restricted type (booking)", () => {
    it("select reaches SQL — the gate does NOT force-empty an authorized read", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
      const result = await api.select("booking", { columns: ["label"], limit: 10 });
      expect(result.columns).toEqual(["label"]);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(db.executeCalls).toBeGreaterThan(0);
    });

    it("count reaches SQL and returns the live count", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
      const result = await api.count("booking");
      expect(result).toBe(7);
      expect(db.selectCalls).toBeGreaterThan(0);
    });

    it("byDate reaches SQL and returns rows", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
      const result = await api.byDate("booking", "from_date", 10);
      expect(result.length).toBeGreaterThan(0);
      expect(db.selectCalls).toBeGreaterThan(0);
    });
  });

  describe("public type (bed, read:[\"*\"]) reaches SQL for BOTH roles", () => {
    it("member can read bed", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology));
      const result = await api.select("bed", { columns: ["code"], limit: 10 });
      expect(result.columns).toEqual(["code"]);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(db.executeCalls).toBeGreaterThan(0);
    });

    it("steward can read bed", async () => {
      const db = makeStubDb();
      const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
      const result = await api.count("bed");
      expect(result).toBe(7);
      expect(db.selectCalls).toBeGreaterThan(0);
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
});
