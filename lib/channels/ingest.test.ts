// lib/channels/ingest.test.ts
//
// ingestChannelRows is the generalized raw_inbox insert path shared by every
// inbound channel (the open /api/ingest webhook and the per-platform channel
// webhooks). It factors the chunked, transactional insert from the CSV route so
// the `source` is a parameter rather than a literal.
//
// These tests use a FAKE db (no real Postgres): a transaction runner that
// records every chunk inserted and returns synthetic ids. We assert:
//   - rows are stamped with the given source,
//   - inserts are chunked by CHUNK_SIZE,
//   - the whole thing runs inside ONE transaction,
//   - the return shape is { ids, count },
//   - MAX_ROWS is enforced (throws),
//   - an empty row list is a no-op (count 0).

import { describe, expect, it, vi } from "vitest";
import {
  ingestChannelRows,
  CHANNEL_INGEST_CHUNK_SIZE,
  CHANNEL_INGEST_MAX_ROWS,
} from "@/lib/channels/ingest";
import type { Database } from "@/lib/db/client";

// Build a fake db whose .transaction(cb) invokes cb with a tx whose
// insert(...).values(chunk).returning() records the chunk and returns ids.
function makeFakeDb() {
  const insertedChunks: { source: string; payload: unknown }[][] = [];
  let idCounter = 0;

  type FakeTx = {
    insert: (table: unknown) => {
      values: (values: { source: string; payload: unknown }[]) => {
        returning: (cols: unknown) => Promise<{ id: string }[]>;
      };
    };
  };

  const tx: FakeTx = {
    insert: (_table: unknown) => ({
      values: (values: { source: string; payload: unknown }[]) => ({
        returning: async (_cols: unknown) => {
          insertedChunks.push(values);
          return values.map(() => ({ id: `id-${idCounter++}` }));
        },
      }),
    }),
  };

  const transaction = vi.fn(async (cb: (tx: FakeTx) => Promise<void>) => {
    await cb(tx);
  });

  const db = { transaction } as unknown as Database;
  return { db, insertedChunks, transaction };
}

describe("ingestChannelRows", () => {
  it("stamps the given source on every row and returns { ids, count }", async () => {
    const { db, insertedChunks } = makeFakeDb();
    const rows = [{ text: "a" }, { text: "b" }, { text: "c" }];

    const result = await ingestChannelRows(db, "telegram", rows);

    expect(result.count).toBe(3);
    expect(result.ids).toHaveLength(3);
    // every inserted row carries source='telegram' and the original payload
    const flat = insertedChunks.flat();
    expect(flat).toHaveLength(3);
    expect(flat.every((r) => r.source === "telegram")).toBe(true);
    expect(flat.map((r) => r.payload)).toEqual(rows);
  });

  it("chunks inserts by CHANNEL_INGEST_CHUNK_SIZE", async () => {
    const { db, insertedChunks, transaction } = makeFakeDb();
    const n = CHANNEL_INGEST_CHUNK_SIZE + 5; // forces a second chunk
    const rows = Array.from({ length: n }, (_, i) => ({ i }));

    const result = await ingestChannelRows(db, "webhook", rows);

    expect(result.count).toBe(n);
    // exactly one transaction, two chunks (CHUNK_SIZE + remainder)
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(insertedChunks).toHaveLength(2);
    expect(insertedChunks[0]).toHaveLength(CHANNEL_INGEST_CHUNK_SIZE);
    expect(insertedChunks[1]).toHaveLength(5);
  });

  it("is a no-op (count 0, no transaction) for an empty row list", async () => {
    const { db, transaction } = makeFakeDb();
    const result = await ingestChannelRows(db, "telegram", []);
    expect(result).toEqual({ ids: [], count: 0 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("throws when rows exceed CHANNEL_INGEST_MAX_ROWS", async () => {
    const { db, transaction } = makeFakeDb();
    const rows = Array.from({ length: CHANNEL_INGEST_MAX_ROWS + 1 }, () => ({}));
    await expect(ingestChannelRows(db, "telegram", rows)).rejects.toThrow(
      /too many rows/i,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("honors a custom chunkSize option", async () => {
    const { db, insertedChunks } = makeFakeDb();
    const rows = Array.from({ length: 5 }, (_, i) => ({ i }));
    await ingestChannelRows(db, "telegram", rows, { chunkSize: 2 });
    expect(insertedChunks.map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it("honors a custom maxRows option", async () => {
    const { db } = makeFakeDb();
    const rows = Array.from({ length: 3 }, () => ({}));
    await expect(
      ingestChannelRows(db, "telegram", rows, { maxRows: 2 }),
    ).rejects.toThrow(/too many rows/i);
  });
});
