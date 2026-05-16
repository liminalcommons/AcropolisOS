import { randomUUID } from "node:crypto";

export interface AuditEntryInput {
  actor: string;
  actor_role: string;
  via: string;
  subject_type: string;
  subject_id: string;
  before: unknown | null;
  after: unknown | null;
  metadata?: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  at: Date;
  actor: string;
  actor_role: string;
  via: string;
  subject_type: string;
  subject_id: string;
  before: unknown | null;
  after: unknown | null;
  metadata: Record<string, unknown>;
}

export interface AuditStore {
  insertOntologyAudit(input: AuditEntryInput): Promise<AuditRow>;
  insertActionAudit(input: AuditEntryInput): Promise<AuditRow>;
  listOntologyAudit(): Promise<AuditRow[]>;
  listActionAudit(): Promise<AuditRow[]>;
}

function freezeRow(input: AuditEntryInput): AuditRow {
  return {
    id: randomUUID(),
    at: new Date(),
    actor: input.actor,
    actor_role: input.actor_role,
    via: input.via,
    subject_type: input.subject_type,
    subject_id: input.subject_id,
    before:
      input.before === null || input.before === undefined
        ? null
        : structuredClone(input.before),
    after:
      input.after === null || input.after === undefined
        ? null
        : structuredClone(input.after),
    metadata: input.metadata ? structuredClone(input.metadata) : {},
  };
}

export class InMemoryAuditStore implements AuditStore {
  private readonly ontologyRows: AuditRow[] = [];
  private readonly actionRows: AuditRow[] = [];

  async insertOntologyAudit(input: AuditEntryInput): Promise<AuditRow> {
    const row = freezeRow(input);
    this.ontologyRows.push(row);
    return structuredClone(row);
  }

  async insertActionAudit(input: AuditEntryInput): Promise<AuditRow> {
    const row = freezeRow(input);
    this.actionRows.push(row);
    return structuredClone(row);
  }

  async listOntologyAudit(): Promise<AuditRow[]> {
    return this.ontologyRows.map((r) => structuredClone(r));
  }

  async listActionAudit(): Promise<AuditRow[]> {
    return this.actionRows.map((r) => structuredClone(r));
  }
}

export async function recordOntologyChange(
  store: AuditStore,
  input: AuditEntryInput,
): Promise<AuditRow> {
  return store.insertOntologyAudit(input);
}

export async function recordActionInvocation(
  store: AuditStore,
  input: AuditEntryInput,
): Promise<AuditRow> {
  return store.insertActionAudit(input);
}
