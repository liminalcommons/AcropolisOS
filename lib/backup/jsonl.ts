import type { AuditRow } from "../audit/writer";

interface AuditRowJson {
  id: string;
  at: string;
  actor: string;
  actor_role: string;
  via: string;
  subject_type: string;
  subject_id: string;
  before: unknown | null;
  after: unknown | null;
  metadata: Record<string, unknown>;
}

export function serializeAuditJsonl(rows: AuditRow[]): string {
  if (rows.length === 0) return "";
  return rows.map(rowToJson).map((j) => JSON.stringify(j)).join("\n") + "\n";
}

export function parseAuditJsonl(jsonl: string): AuditRow[] {
  return jsonl
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => jsonToRow(JSON.parse(line) as AuditRowJson));
}

function rowToJson(row: AuditRow): AuditRowJson {
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor,
    actor_role: row.actor_role,
    via: row.via,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    before: row.before ?? null,
    after: row.after ?? null,
    metadata: row.metadata ?? {},
  };
}

function jsonToRow(j: AuditRowJson): AuditRow {
  return {
    id: j.id,
    at: new Date(j.at),
    actor: j.actor,
    actor_role: j.actor_role,
    via: j.via,
    subject_type: j.subject_type,
    subject_id: j.subject_id,
    before: j.before ?? null,
    after: j.after ?? null,
    metadata: j.metadata ?? {},
  };
}
