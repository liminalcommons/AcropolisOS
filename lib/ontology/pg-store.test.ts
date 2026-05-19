// M2.2 step-2: PgOntologyStore unit test.
//
// Verifies that `createPgOntologyStore(db)` returns an OntologyStore whose
// Member/Event/MeetingMinute object-accessors invoke the expected drizzle
// operations against the right tables. The test stubs the drizzle Database
// surface so it runs hermetically — full SQL semantics are covered by the
// existing audit-store + drizzle integration tests.
//
// Why this layer: change-tier.ts:27 calls `ctx.objects.Member.update(...)`
// which currently throws in production because no Pg-backed implementation
// of the OntologyStore interface (declared at lib/ontology/ctx.ts:47-56)
// exists. This module is that implementation.

import { describe, expect, it } from "vitest";
import {
  member as memberTable,
  event as eventTable,
  meeting_minute as meetingMinuteTable,
} from "../db/schema.generated";
import type { Database } from "../db/client";
import { createPgOntologyStore } from "./pg-store";

interface QBCapture {
  table?: unknown;
  setValues?: unknown;
  whereCond?: unknown;
  inserted?: unknown;
  returningRows: unknown[];
  selectRows: unknown[];
}

function buildStubDb(opts: {
  selectRows?: unknown[];
  returningRows?: unknown[];
} = {}): { db: Database; capture: QBCapture } {
  const capture: QBCapture = {
    returningRows: opts.returningRows ?? [],
    selectRows: opts.selectRows ?? [],
  };

  const updateChain = {
    set: (values: unknown) => {
      capture.setValues = values;
      return {
        where: (cond: unknown) => {
          capture.whereCond = cond;
          return {
            returning: async () => capture.returningRows,
          };
        },
      };
    },
  };

  const selectChain = {
    from: (table: unknown) => {
      capture.table = table;
      return {
        where: (cond: unknown) => {
          capture.whereCond = cond;
          return {
            limit: async (_n: number) => capture.selectRows,
          };
        },
        // findMany unfiltered path
        then: (resolve: (rows: unknown[]) => unknown) => {
          return Promise.resolve(resolve(capture.selectRows));
        },
      };
    },
  };

  const insertChain = (table: unknown) => ({
    values: (row: unknown) => {
      capture.table = table;
      capture.inserted = row;
      return {
        returning: async () => capture.returningRows,
      };
    },
  });

  const deleteChain = (table: unknown) => ({
    where: (cond: unknown) => {
      capture.table = table;
      capture.whereCond = cond;
      return {
        returning: async () => capture.returningRows,
      };
    },
  });

  const db = {
    update: (table: unknown) => {
      capture.table = table;
      return updateChain;
    },
    select: () => selectChain,
    insert: insertChain,
    delete: deleteChain,
  } as unknown as Database;

  return { db, capture };
}

describe("createPgOntologyStore — M2.2 step 2", () => {
  it("exposes Member/Event/MeetingMinute accessors", () => {
    const { db } = buildStubDb();
    const store = createPgOntologyStore(db);
    expect(store.objects.Member).toBeDefined();
    expect(store.objects.Event).toBeDefined();
    expect(store.objects.MeetingMinute).toBeDefined();
    expect(typeof store.objects.Member.findById).toBe("function");
    expect(typeof store.objects.Member.update).toBe("function");
  });

  it("Member.update issues drizzle update against `member` table and returns first row", async () => {
    const memberRow = {
      id: "abc-id",
      full_name: "Alice",
      email: "a@x.test",
      joined_at: "2024-01-01",
      tier: "sustaining",
      notes: "",
    };
    const { db, capture } = buildStubDb({ returningRows: [memberRow] });
    const store = createPgOntologyStore(db);

    const updated = await store.objects.Member.update("abc-id", {
      tier: "sustaining",
    });

    expect(capture.table).toBe(memberTable);
    expect(capture.setValues).toEqual({ tier: "sustaining" });
    expect(capture.whereCond).toBeDefined();
    expect(updated).toEqual(memberRow);
  });

  it("Member.update returns null when no row was updated", async () => {
    const { db } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    const out = await store.objects.Member.update("missing-id", {
      tier: "basic",
    });
    expect(out).toBeNull();
  });

  it("Member.findById issues select against `member` and returns first row or null", async () => {
    const row = {
      id: "id-1",
      full_name: "Bob",
      email: "b@x.test",
      joined_at: "2024-02-01",
      tier: "basic",
      notes: "",
    };
    {
      const { db, capture } = buildStubDb({ selectRows: [row] });
      const store = createPgOntologyStore(db);
      const out = await store.objects.Member.findById("id-1");
      expect(capture.table).toBe(memberTable);
      expect(out).toEqual(row);
    }
    {
      const { db } = buildStubDb({ selectRows: [] });
      const store = createPgOntologyStore(db);
      const out = await store.objects.Member.findById("nope");
      expect(out).toBeNull();
    }
  });

  it("Member.create inserts into `member` and returns the inserted row", async () => {
    const row = {
      id: "x-1",
      full_name: "Carol",
      email: "c@x.test",
      joined_at: "2024-03-01",
      tier: "basic" as const,
      notes: "",
    };
    const { db, capture } = buildStubDb({ returningRows: [row] });
    const store = createPgOntologyStore(db);
    const out = await store.objects.Member.create(row);
    expect(capture.table).toBe(memberTable);
    expect(capture.inserted).toEqual(row);
    expect(out).toEqual(row);
  });

  it("Event accessor targets the `event` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.Event.update("e-1", { title: "x" });
    expect(capture.table).toBe(eventTable);
  });

  it("MeetingMinute accessor targets the `meeting_minute` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.MeetingMinute.update("mm-1", { title: "x" });
    expect(capture.table).toBe(meetingMinuteTable);
  });

  it("provides a links.attended accessor (M2.2 surface — even if unused yet)", () => {
    const { db } = buildStubDb();
    const store = createPgOntologyStore(db);
    expect(store.links.attended).toBeDefined();
    expect(typeof store.links.attended.create).toBe("function");
  });
});
