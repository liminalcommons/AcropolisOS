import { randomUUID } from "node:crypto";
import type { Database } from "../db/client";
import type { InboxPayload } from "./parsers";

export interface InboxItem {
  id: string;
  at: string;
  source_filename: string;
  mime_type: string;
  payload: InboxPayload;
  claimed_by_proposal_id: string | null;
}

export interface InboxInsert {
  source_filename: string;
  mime_type: string;
  payload: InboxPayload;
}

export interface InboxStore {
  insertMany(rows: InboxInsert[]): Promise<InboxItem[]>;
  list(opts?: { unclaimedOnly?: boolean; limit?: number }): Promise<InboxItem[]>;
  get(id: string): Promise<InboxItem | null>;
}

export class InMemoryInboxStore implements InboxStore {
  private items: InboxItem[] = [];

  async insertMany(rows: InboxInsert[]): Promise<InboxItem[]> {
    const inserted = rows.map((r) => ({
      id: randomUUID(),
      at: new Date().toISOString(),
      source_filename: r.source_filename,
      mime_type: r.mime_type,
      payload: r.payload,
      claimed_by_proposal_id: null,
    }));
    this.items.push(...inserted);
    return inserted;
  }

  async list(opts?: { unclaimedOnly?: boolean; limit?: number }): Promise<InboxItem[]> {
    let result = [...this.items];
    if (opts?.unclaimedOnly) {
      result = result.filter((i) => i.claimed_by_proposal_id === null);
    }
    if (opts?.limit !== undefined) {
      result = result.slice(0, opts.limit);
    }
    return result;
  }

  async get(id: string): Promise<InboxItem | null> {
    return this.items.find((i) => i.id === id) ?? null;
  }
}

// PgInboxStore: write and read inbox rows from the live Postgres `inbox` table.
// Used at runtime when DATABASE_URL is configured (production + Docker).
// Tests continue to use InMemoryInboxStore via vi.mock("@/lib/inbox/singleton").
export class PgInboxStore implements InboxStore {
  constructor(private readonly db: Database) {}

  async insertMany(rows: InboxInsert[]): Promise<InboxItem[]> {
    if (rows.length === 0) return [];
    const { inbox } = await import("../db/schema");
    const inserted = await this.db
      .insert(inbox)
      .values(
        rows.map((r) => ({
          source_filename: r.source_filename,
          mime_type: r.mime_type,
          payload: r.payload as Record<string, unknown>,
        })),
      )
      .returning();
    return inserted.map(rowToItem);
  }

  async list(opts?: { unclaimedOnly?: boolean; limit?: number }): Promise<InboxItem[]> {
    const { inbox } = await import("../db/schema");
    const { isNull, desc } = await import("drizzle-orm");
    let query = this.db
      .select()
      .from(inbox)
      .orderBy(desc(inbox.at))
      .$dynamic();
    if (opts?.unclaimedOnly) {
      query = query.where(isNull(inbox.claimed_by_proposal_id));
    }
    if (opts?.limit !== undefined) {
      query = query.limit(opts.limit);
    }
    const rows = await query;
    return rows.map(rowToItem);
  }

  async get(id: string): Promise<InboxItem | null> {
    const { inbox } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await this.db
      .select()
      .from(inbox)
      .where(eq(inbox.id, id))
      .limit(1);
    return rows[0] ? rowToItem(rows[0]) : null;
  }
}

function rowToItem(row: {
  id: string;
  at: Date;
  source_filename: string;
  mime_type: string;
  payload: unknown;
  claimed_by_proposal_id: string | null;
}): InboxItem {
  return {
    id: row.id,
    at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
    source_filename: row.source_filename,
    mime_type: row.mime_type,
    payload: (row.payload ?? {}) as InboxPayload,
    claimed_by_proposal_id: row.claimed_by_proposal_id,
  };
}
