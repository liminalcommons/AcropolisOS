// Shared test helper: a hermetic stub of the drizzle Database surface used by
// pg-store tests. Extracted verbatim from pg-store.test.ts so multiple test
// modules can build the same capturing stub. No behavior change.

import type { Database } from "../../db/client";

export interface QBCapture {
  table?: unknown;
  setValues?: unknown;
  whereCond?: unknown;
  inserted?: unknown;
  returningRows: unknown[];
  selectRows: unknown[];
}

export function buildStubDb(opts: {
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
