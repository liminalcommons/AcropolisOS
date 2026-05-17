import { randomUUID } from "node:crypto";
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
  list(): Promise<InboxItem[]>;
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

  async list(): Promise<InboxItem[]> {
    return [...this.items];
  }

  async get(id: string): Promise<InboxItem | null> {
    return this.items.find((i) => i.id === id) ?? null;
  }
}
