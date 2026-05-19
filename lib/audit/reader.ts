import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import type { AuditRow } from "./writer";

export interface AuditFilter {
  actor?: string;
  subject_type?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}

export interface DataAuditRow {
  id: string;
  at: Date;
  table_name: string;
  row_id: string;
  operation: string;
  before: unknown | null;
  after: unknown | null;
  db_actor: string;
}

export interface DataAuditFilter {
  table_name?: string;
  row_id?: string;
  operation?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}

const DEFAULT_LIMIT = 100;

// Pure, in-memory filter — sorted by `at` descending then limit applied. Used
// both as the in-memory test target and as a fallback after a SQL query that
// over-fetches (small enough table that we can afford it; revisit if audit
// tables grow large).
export function filterAuditRows(
  rows: AuditRow[],
  filter: AuditFilter,
): AuditRow[] {
  const limit = filter.limit ?? DEFAULT_LIMIT;
  return rows
    .filter((r) => {
      if (filter.actor !== undefined && r.actor !== filter.actor) return false;
      if (
        filter.subject_type !== undefined &&
        r.subject_type !== filter.subject_type
      )
        return false;
      if (filter.since !== undefined && r.at < filter.since) return false;
      if (filter.until !== undefined && r.at > filter.until) return false;
      return true;
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}

// M2.5: action-composition reader.
//
// A composing action's audit trail is a tree rooted at the parent's pending
// row, with children pointing back via `metadata.parent_action_audit_id`
// (same field side-effects use). `buildActionChain` flattens that subtree
// into a depth-tagged list, sorted within each generation by `at` ASC so
// the chain reads top-to-bottom the way it executed.
//
// Pure / in-memory: the PG reader fetches all rows once and applies this.
// Audit tables are small enough today that walking in-memory is fine; the
// alternative (recursive CTE) is reserved for if `action_audit` grows large.

export interface ActionChainEntry {
  row: AuditRow;
  depth: number;
}

export function buildActionChain(
  rows: AuditRow[],
  rootId: string,
): ActionChainEntry[] {
  const root = rows.find((r) => r.id === rootId);
  if (!root) return [];

  // Bucket children by parent id, sorted by `at` ASC so siblings come out
  // in execution order regardless of input order.
  const byParent = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const parent = (r.metadata as { parent_action_audit_id?: string })
      .parent_action_audit_id;
    if (!parent) continue;
    const list = byParent.get(parent) ?? [];
    list.push(r);
    byParent.set(parent, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  const out: ActionChainEntry[] = [];
  const visited = new Set<string>();
  function walk(row: AuditRow, depth: number): void {
    if (visited.has(row.id)) return; // cycle defence
    visited.add(row.id);
    out.push({ row, depth });
    const kids = byParent.get(row.id) ?? [];
    for (const k of kids) walk(k, depth + 1);
  }
  walk(root, 0);
  return out;
}

export function filterDataAuditRows(
  rows: DataAuditRow[],
  filter: DataAuditFilter,
): DataAuditRow[] {
  const limit = filter.limit ?? DEFAULT_LIMIT;
  return rows
    .filter((r) => {
      if (
        filter.table_name !== undefined &&
        r.table_name !== filter.table_name
      )
        return false;
      if (filter.row_id !== undefined && r.row_id !== filter.row_id)
        return false;
      if (filter.operation !== undefined && r.operation !== filter.operation)
        return false;
      if (filter.since !== undefined && r.at < filter.since) return false;
      if (filter.until !== undefined && r.at > filter.until) return false;
      return true;
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}

// PG-backed reader. Wraps the existing AuditStore-shape with filter support
// + a `listData` accessor (data_audit isn't declared in lib/db/schema.ts
// because the table is created by the hand-rolled 0003_data_audit.sql
// migration, not drizzle's generator).
export class PgAuditReader {
  constructor(private readonly db: Database) {}

  async listOntology(filter: AuditFilter = {}): Promise<AuditRow[]> {
    const rows = (await this.db.execute(
      sql`SELECT id, at, actor, actor_role, via, subject_type, subject_id,
                 before, after, metadata
          FROM ontology_audit
          ORDER BY at DESC
          LIMIT 1000`,
    )) as unknown as Array<{
      id: string;
      at: Date | string;
      actor: string;
      actor_role: string;
      via: string;
      subject_type: string;
      subject_id: string;
      before: unknown;
      after: unknown;
      metadata: unknown;
    }>;
    return filterAuditRows(rows.map(normalizeAuditRow), filter);
  }

  async listAction(filter: AuditFilter = {}): Promise<AuditRow[]> {
    const rows = (await this.db.execute(
      sql`SELECT id, at, actor, actor_role, via, subject_type, subject_id,
                 before, after, metadata
          FROM action_audit
          ORDER BY at DESC
          LIMIT 1000`,
    )) as unknown as Array<{
      id: string;
      at: Date | string;
      actor: string;
      actor_role: string;
      via: string;
      subject_type: string;
      subject_id: string;
      before: unknown;
      after: unknown;
      metadata: unknown;
    }>;
    return filterAuditRows(rows.map(normalizeAuditRow), filter);
  }

  // M2.5: hydrate the full composition chain rooted at `rootId`.
  // Pulls all action_audit rows (LIMIT 1000, same as listAction) and walks
  // the parent_action_audit_id graph in-memory. Returns rows in depth-first
  // execution order (root first, then each subtree in `at` ASC).
  async loadActionChain(rootId: string): Promise<ActionChainEntry[]> {
    const rows = await this.listAction({ limit: 1000 });
    return buildActionChain(rows, rootId);
  }

  async listData(filter: DataAuditFilter = {}): Promise<DataAuditRow[]> {
    const rows = (await this.db.execute(
      sql`SELECT id, at, table_name, row_id, operation, before, after, db_actor
          FROM data_audit
          ORDER BY at DESC
          LIMIT 1000`,
    )) as unknown as Array<{
      id: string;
      at: Date | string;
      table_name: string;
      row_id: string;
      operation: string;
      before: unknown;
      after: unknown;
      db_actor: string;
    }>;
    return filterDataAuditRows(rows.map(normalizeDataRow), filter);
  }
}

function normalizeAuditRow(row: {
  id: string;
  at: Date | string;
  actor: string;
  actor_role: string;
  via: string;
  subject_type: string;
  subject_id: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
}): AuditRow {
  return {
    id: row.id,
    at: row.at instanceof Date ? row.at : new Date(String(row.at)),
    actor: row.actor,
    actor_role: row.actor_role,
    via: row.via,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    before: row.before ?? null,
    after: row.after ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

function normalizeDataRow(row: {
  id: string;
  at: Date | string;
  table_name: string;
  row_id: string;
  operation: string;
  before: unknown;
  after: unknown;
  db_actor: string;
}): DataAuditRow {
  return {
    id: row.id,
    at: row.at instanceof Date ? row.at : new Date(String(row.at)),
    table_name: row.table_name,
    row_id: row.row_id,
    operation: row.operation,
    before: row.before ?? null,
    after: row.after ?? null,
    db_actor: row.db_actor,
  };
}
