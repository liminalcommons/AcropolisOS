// REF-LABEL resolution — permission-aware, fail-closed.
//
// Proves the security contract: a data_table/roster column that is a REF (FK to
// another object type) is rewritten from the raw target UUID to the target's
// human label (its title_property) — but ONLY when the viewer is permitted to
// read the TARGET type. An unreadable target leaves the raw UUID in place (no
// fetch, no leak), because resolution reuses the SAME permission-aware read path
// (createReadOnlyDataApi + buildCanReadType) the rows themselves came through.
//
// Cases:
//   1. bed.room (Room read:["*"]) → resolves to Room.code for BOTH steward & member.
//   2. booking.guest (Guest read:[steward,manager]):
//        - member viewer  → guest stays the raw UUID (NOT fetched, no leak)
//        - steward viewer → resolves to Guest.full_name
//   3. rows with no ref columns → unchanged.
//   4. null / missing ref value → stays as-is.
//   5. batched: one fetch per distinct target type, not per row (no N+1).
//   6. scale: target with >500 rows — ref to row #550 RESOLVES (no 500 ceiling).
//   7. precision: single referenced id → selectByIds called with exactly 1 id.

import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { resolveRefLabels } from "./resolve-refs";
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

// ── Target-row fixtures ──────────────────────────────────────────────────────

const ROOM_ROWS = [
  { id: "room-1", code: "D3" },
  { id: "room-2", code: "P5" },
];

const GUEST_ROWS = [
  { id: "guest-1", full_name: "Lena Petrov" },
  { id: "guest-2", full_name: "Anna Vogt" },
];

// ── Stub db ──────────────────────────────────────────────────────────────────
//
// resolveRefLabels now fetches target labels via api.selectByIds(), which issues
// db.execute(sql) containing a WHERE "id" IN (...) clause. The stub inspects the
// SQL text to decide which table is being queried, records the requested ids and
// call counts so we can assert (a) exact-id fetching and (b) batching discipline.
//
// LARGE_ROOM_ROWS: a fixture of 600 rooms, used to prove that selectByIds
// resolves row #550 correctly (no 500-row ceiling exists in the new path).

const LARGE_ROOM_ROWS: { id: string; code: string }[] = Array.from(
  { length: 600 },
  (_, i) => ({ id: `room-${i + 1}`, code: `R-${i + 1}` }),
);

interface StubDb {
  execCountByTable: Record<string, number>;
  requestedIdsByTable: Record<string, string[][]>;
  asDatabase(): Database;
}

function makeStubDb(opts?: { largeRoomFixture?: boolean }): StubDb {
  const execCountByTable: Record<string, number> = {};
  const requestedIdsByTable: Record<string, string[][]> = {};
  const uselargeRooms = opts?.largeRoomFixture ?? false;

  const stub = {
    execCountByTable,
    requestedIdsByTable,
    asDatabase(): Database {
      return this as unknown as Database;
    },
    async execute(query: unknown) {
      // read-api selectByIds builds:
      //   SELECT "id", "<title>" FROM "<table>" WHERE "id" IN ($1, $2, …)
      // read-api select builds:
      //   SELECT <cols> FROM "<table>" LIMIT n
      // Both reach db.execute; we handle both shapes.
      const text = stringifySql(query);
      const table = /FROM\s+"([a-z_]+)"/i.exec(text)?.[1] ?? "";
      execCountByTable[table] = (execCountByTable[table] ?? 0) + 1;

      // Extract bound parameter values for id tracking.
      // drizzle sql template stores params as non-raw chunks; stringifySql
      // renders them inline. We extract them from the SQL text representation
      // when an IN clause is present (used only by selectByIds path).
      const inMatch = /WHERE\s+"id"\s+IN\s+\(([^)]+)\)/i.exec(text);
      if (inMatch) {
        // params are rendered as their string value between commas
        const paramValues = inMatch[1].split(",").map((s) => s.trim());
        if (!requestedIdsByTable[table]) requestedIdsByTable[table] = [];
        requestedIdsByTable[table].push(paramValues);
      }

      const roomSource = uselargeRooms ? LARGE_ROOM_ROWS : ROOM_ROWS;
      if (table === "room") return projectRows(roomSource, text);
      if (table === "guest") return projectRows(GUEST_ROWS, text);
      return [];
    },
    // count/byDate paths are unused by resolveRefLabels (it only calls selectByIds),
    // but provide a benign chain so any stray call is harmless.
    select() {
      return {
        from() {
          return {
            limit() {
              return Promise.resolve([]);
            },
            then(resolve: (r: unknown[]) => unknown) {
              return Promise.resolve([]).then(resolve);
            },
          };
        },
      };
    },
  };
  return stub;
}

// Project fixture rows to only the columns named in the SELECT list, so the
// returned shape matches what real SQL would return for the requested columns.
function projectRows(
  rows: Record<string, unknown>[],
  sqlText: string,
): Record<string, unknown>[] {
  const selectPart = /SELECT\s+(.+?)\s+FROM/is.exec(sqlText)?.[1] ?? "";
  const cols = [...selectPart.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  if (cols.length === 0) return rows;
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of cols) out[c] = r[c];
    return out;
  });
}

// Best-effort stringify of a drizzle sql object for assertion purposes.
// drizzle nests sql.raw(...) fragments as child sql objects each with their own
// queryChunks, so flatten recursively. A chunk with `value: string[]` is literal
// text; a chunk with `queryChunks` is a nested fragment; anything else is a bound
// param (rendered as its string form — irrelevant to table/column extraction).
function stringifySql(query: unknown): string {
  if (query == null) return "";
  const q = query as { queryChunks?: unknown[]; value?: unknown };
  if (Array.isArray(q.queryChunks)) {
    return q.queryChunks.map((c) => stringifySql(c)).join("");
  }
  if (q.value !== undefined) {
    return Array.isArray(q.value) ? q.value.join("") : String(q.value ?? "");
  }
  return typeof query === "object" ? "" : String(query);
}

// ── Ontology ─────────────────────────────────────────────────────────────────

let ontology: Ontology;

beforeAll(async () => {
  ontology = await loadOntology(path.resolve(__dirname, "../../ontology"));
});

describe("resolveRefLabels — sanity on the shipped ontology", () => {
  it("Bed.room is a ref → Room, Room.title_property = code", () => {
    const bed = ontology.object_types.Bed;
    const roomProp = bed.properties.room;
    expect(roomProp && "type" in roomProp && roomProp.type).toBe("ref");
    expect(ontology.object_types.Room.title_property).toBe("code");
  });

  it("Booking.guest is a ref → Guest, Guest.title_property = full_name, Guest read:[steward,manager]", () => {
    const booking = ontology.object_types.Booking;
    const guestProp = booking.properties.guest;
    expect(guestProp && "type" in guestProp && guestProp.type).toBe("ref");
    expect(ontology.object_types.Guest.title_property).toBe("full_name");
    expect(ontology.object_types.Guest.permissions?.read).toEqual([
      "steward",
      "manager",
    ]);
  });
});

describe("public target (bed.room → Room read:['*'])", () => {
  const bedRows = [
    { id: "bed-1", code: "D3-A2", room: "room-1" },
    { id: "bed-2", code: "P5-01", room: "room-2" },
  ];

  it("steward: room UUID resolves to Room.code", async () => {
    const db = makeStubDb();
    const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
    const out = await resolveRefLabels(
      structuredClone(bedRows),
      "bed",
      ["code", "room"],
      ontology,
      api,
    );
    expect(out[0].room).toBe("D3");
    expect(out[1].room).toBe("P5");
    // non-ref column untouched
    expect(out[0].code).toBe("D3-A2");
  });

  it("member: room UUID also resolves (Room is public)", async () => {
    const db = makeStubDb();
    const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology));
    const out = await resolveRefLabels(
      structuredClone(bedRows),
      "bed",
      ["code", "room"],
      ontology,
      api,
    );
    expect(out[0].room).toBe("D3");
    expect(out[1].room).toBe("P5");
  });
});

describe("restricted target (booking.guest → Guest read:[steward,manager]) — FAIL CLOSED", () => {
  const bookingRows = [
    { id: "bk-1", label: "Lena / D3-A2", guest: "guest-1" },
    { id: "bk-2", label: "Anna / P5-01", guest: "guest-2" },
  ];

  it("member viewer: guest stays the RAW UUID and no fetch is issued (no leak)", async () => {
    const db = makeStubDb();
    const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(member, ontology));
    const out = await resolveRefLabels(
      structuredClone(bookingRows),
      "booking",
      ["label", "guest"],
      ontology,
      api,
    );
    // RAW UUID retained — NOT the full_name.
    expect(out[0].guest).toBe("guest-1");
    expect(out[1].guest).toBe("guest-2");
    // Fail-closed gate fired BEFORE SQL: the guest table was never read.
    expect(db.execCountByTable.guest ?? 0).toBe(0);
  });

  it("steward viewer: guest UUID resolves to Guest.full_name", async () => {
    const db = makeStubDb();
    const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
    const out = await resolveRefLabels(
      structuredClone(bookingRows),
      "booking",
      ["label", "guest"],
      ontology,
      api,
    );
    expect(out[0].guest).toBe("Lena Petrov");
    expect(out[1].guest).toBe("Anna Vogt");
  });
});

describe("edge cases", () => {
  it("rows with no ref columns are unchanged", async () => {
    const db = makeStubDb();
    const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
    const rows = [
      { id: "g-1", full_name: "Lena", country: "DE" },
      { id: "g-2", full_name: "Anna", country: "AT" },
    ];
    const out = await resolveRefLabels(
      structuredClone(rows),
      "guest",
      ["full_name", "country"],
      ontology,
      api,
    );
    expect(out).toEqual(rows);
    // No ref columns → no target fetches at all.
    expect(Object.keys(db.execCountByTable)).toHaveLength(0);
  });

  it("null/missing ref value stays as-is", async () => {
    const db = makeStubDb();
    const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
    const rows = [
      { id: "bed-1", code: "D3-A2", room: "room-1" },
      { id: "bed-2", code: "D3-A3", room: null },
      { id: "bed-3", code: "D3-A4" }, // room absent
    ];
    const out = await resolveRefLabels(
      structuredClone(rows),
      "bed",
      ["code", "room"],
      ontology,
      api,
    );
    expect(out[0].room).toBe("D3"); // resolved
    expect(out[1].room).toBeNull(); // null preserved
    expect(out[2].room).toBeUndefined(); // absent preserved
  });

  it("empty rows array returns empty, no fetch", async () => {
    const db = makeStubDb();
    const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
    const out = await resolveRefLabels([], "bed", ["code", "room"], ontology, api);
    expect(out).toEqual([]);
    expect(Object.keys(db.execCountByTable)).toHaveLength(0);
  });
});

describe("batching — one fetch per distinct target type (no N+1)", () => {
  it("many rows over the same ref column → a single target-type fetch", async () => {
    const db = makeStubDb();
    const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
    // 10 bed rows referencing only 2 distinct rooms.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `bed-${i}`,
      code: `B-${i}`,
      room: i % 2 === 0 ? "room-1" : "room-2",
    }));
    const out = await resolveRefLabels(rows, "bed", ["code", "room"], ontology, api);
    expect(out[0].room).toBe("D3");
    expect(out[1].room).toBe("P5");
    // Exactly ONE read of the room table for all 10 rows.
    expect(db.execCountByTable.room).toBe(1);
  });
});

describe("scale — no 500-row ceiling (selectByIds fetches exactly referenced ids)", () => {
  it("ref to row #550 in a 600-row fixture resolves (old limit:500 path would have missed it)", async () => {
    // The old api.select(... limit:500) would never return row-550 because it
    // fetched the first 500 rows of the table. selectByIds fetches ONLY the
    // referenced id, so row #550 resolves regardless of total table size.
    const db = makeStubDb({ largeRoomFixture: true });
    const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
    const rows = [{ id: "bed-x", code: "X", room: "room-550" }];
    const out = await resolveRefLabels(rows, "bed", ["code", "room"], ontology, api);
    // LARGE_ROOM_ROWS[549] → { id: "room-550", code: "R-550" }
    expect(out[0].room).toBe("R-550");
  });

  it("single referenced id → selectByIds is called with exactly that 1 id (no over-fetch)", async () => {
    // Proves precision: only the required ids are requested — not hundreds.
    const db = makeStubDb();
    const api = createReadOnlyDataApi(db.asDatabase(), buildCanReadType(steward, ontology));
    const rows = [{ id: "bed-1", code: "D3-A2", room: "room-1" }];
    await resolveRefLabels(rows, "bed", ["code", "room"], ontology, api);

    // The room table must have been read exactly once.
    expect(db.execCountByTable.room).toBe(1);
    // The IN clause must have contained exactly 1 id: "room-1".
    const calls = db.requestedIdsByTable.room;
    expect(calls).toBeDefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    expect(calls[0][0]).toBe("room-1");
  });
});
