// lib/channels/ingest.ts
//
// ingestChannelRows — the ONE generalized raw_inbox insert path.
//
// Every inbound channel (the open /api/ingest webhook and the per-platform
// channel webhooks like Telegram) deposits messy data into raw_inbox before
// classification. This factors the chunked, transactional insert previously
// inlined in the CSV route so the `source` is a parameter, not a literal:
// new adapters reuse this instead of duplicating insert code.
//
// Limits mirror the CSV route (the prior owner of this pattern):
//   - CHANNEL_INGEST_MAX_ROWS caps a single call (guards pg param overflow + OOM)
//   - CHANNEL_INGEST_CHUNK_SIZE keeps each INSERT under pg's 65535-param ceiling
//
// All chunks insert inside ONE transaction: the call either fully lands or not.

import type { Database } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";

export const CHANNEL_INGEST_MAX_ROWS = 5000;
export const CHANNEL_INGEST_CHUNK_SIZE = 1000; // rows per INSERT — under pg 65535-param ceiling

export interface IngestChannelOptions {
  chunkSize?: number;
  maxRows?: number;
}

export interface IngestChannelResult {
  ids: string[];
  count: number;
}

/**
 * Insert `rows` into raw_inbox, stamping each with `source`, in chunked
 * transactional batches. Returns the inserted ids and their count.
 *
 * - Empty `rows` is a no-op (no transaction opened) returning { ids: [], count: 0 }.
 * - Throws if `rows.length` exceeds the (overridable) max-rows cap.
 */
export async function ingestChannelRows(
  db: Database,
  source: string,
  rows: Record<string, unknown>[],
  options: IngestChannelOptions = {},
): Promise<IngestChannelResult> {
  const maxRows = options.maxRows ?? CHANNEL_INGEST_MAX_ROWS;
  const chunkSize = options.chunkSize ?? CHANNEL_INGEST_CHUNK_SIZE;

  if (rows.length === 0) {
    return { ids: [], count: 0 };
  }
  if (rows.length > maxRows) {
    throw new Error(`too many rows (max ${maxRows})`);
  }

  const ids: string[] = [];
  await db.transaction(async (tx) => {
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.slice(offset, offset + chunkSize);
      const inserted = await tx
        .insert(raw_inbox)
        .values(chunk.map((payload) => ({ source, payload })))
        .returning({ id: raw_inbox.id });
      for (const r of inserted) ids.push(r.id);
    }
  });

  return { ids, count: ids.length };
}
