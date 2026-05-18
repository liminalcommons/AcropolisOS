// Minimal runtime adapters wiring the apply pipeline (lib/proposals/apply.ts)
// to the live Postgres + filesystem + git. Designed for the first live apply
// path; richer column-type inference and ingest mapping can grow here.

import { randomUUID } from "node:crypto";
import { exec as execCb } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { stringify as stringifyYaml } from "yaml";
import type { Database } from "../../db/client";
import type { InboxRow } from "../../db/schema";
import {
  proposals as proposalsTable,
  inbox,
  ontology_audit,
  action_audit,
} from "../../db/schema";
import { eq, inArray, desc } from "drizzle-orm";
import type {
  AuditEntryInput,
  AuditRow,
  AuditStore,
} from "../../audit/writer";
import type {
  GitClient,
  InboxMigrator,
  MigrationPlan,
  MigrationRunner,
  ProposalStatusStore,
  TransactionRunner,
  Tx,
} from "../apply";
import type { ProposalDiff } from "../diff";
import type { ObjectType } from "../../ontology/schema";

const execAsync = promisify(execCb);

// drizzle's tx and the base db share .execute / .insert / .update etc., so
// we widen to Database (the tx is structurally compatible at call sites we
// use below).
type DrizzleTx = Database;

// The apply.ts pipeline treats `Tx` as opaque. Real Postgres tx state lives
// here keyed by an opaque tag string; adapters look it up to get the actual
// drizzle client they can issue statements against.
const txRegistry = new Map<string, DrizzleTx>();

function withTx<T>(tx: Tx, fn: (drizzle: DrizzleTx) => Promise<T>): Promise<T> {
  const drizzle = txRegistry.get(tx.tag);
  if (!drizzle) {
    throw new Error(`apply-pipeline: tx ${tx.tag} not registered`);
  }
  return fn(drizzle);
}

function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function pgColumnType(prop: Record<string, unknown>): string {
  const t = String(prop.type ?? "");
  switch (t) {
    case "uuid":
      return "uuid";
    case "integer":
      return "integer";
    case "decimal":
      return "numeric";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "timestamp":
      return "timestamp with time zone";
    case "string":
    case "email":
    case "enum":
    default:
      return "text";
  }
}

// Build the SQL plan for a proposal. v1 covers:
//  • new object types — CREATE TABLE
//  • property additions on existing types — ALTER TABLE ADD COLUMN (idempotent)
//  • new many-to-many link types — CREATE TABLE for the join
// Everything else (deletes, renames, type changes) is intentionally a no-op
// until a richer migration generator exists.
interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface DrizzleJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export class DiffMigrationRunner implements MigrationRunner {
  constructor(
    private readonly diff: ProposalDiff,
    private readonly db: Database,
    private readonly packageRoot: string = process.cwd(),
  ) {}

  async generate(): Promise<MigrationPlan> {
    const stmts: string[] = [];

    for (const [name, body] of Object.entries(this.diff.new_object_types)) {
      const tableName = snakeCase(name);
      const props = (body as ObjectType).properties ?? {};
      const tableExists = await this.tableExists(tableName);
      if (tableExists) {
        for (const [propName, propDef] of Object.entries(props)) {
          if (propName === "id") continue;
          const col = snakeCase(propName);
          const type = pgColumnType(propDef as Record<string, unknown>);
          stmts.push(
            `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${col}" ${type};`,
          );
        }
      } else {
        const cols: string[] = [
          `"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL`,
        ];
        for (const [propName, propDef] of Object.entries(props)) {
          if (propName === "id") continue;
          const col = snakeCase(propName);
          const type = pgColumnType(propDef as Record<string, unknown>);
          cols.push(`"${col}" ${type}`);
        }
        stmts.push(
          `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${cols.join(",\n  ")}\n);`,
        );
      }
    }

    for (const [name, link] of Object.entries(this.diff.new_link_types)) {
      if ((link as { cardinality?: string }).cardinality !== "many-to-many") {
        continue;
      }
      const from = snakeCase(((link as { from?: string }).from ?? ""));
      const to = snakeCase(((link as { to?: string }).to ?? ""));
      const joinTable = `${from}_${snakeCase(name)}_${to}`;
      stmts.push(
        `CREATE TABLE IF NOT EXISTS "${joinTable}" (\n  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,\n  "from_id" uuid NOT NULL,\n  "to_id" uuid NOT NULL\n);`,
      );
    }

    const tag = `proposal_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
    return { sql: stmts.join("\n"), tag };
  }

  async apply(tx: Tx, plan: MigrationPlan): Promise<void> {
    if (!plan.sql.trim()) return;
    await withTx(tx, async (drizzle) => {
      await drizzle.execute(sql.raw(plan.sql));
    });
  }

  // After the postgres tx commits, write the SQL plan + journal entry to
  // disk so the apply leaves a reproducible artifact alongside the audit row.
  // Idempotent: re-running for the same tag is a no-op. Skips entirely when
  // the SQL plan is empty.
  async persist(plan: MigrationPlan): Promise<void> {
    if (!plan.sql.trim()) return;
    const drizzleDir = path.join(this.packageRoot, "drizzle");
    const metaDir = path.join(drizzleDir, "meta");
    await mkdir(metaDir, { recursive: true });

    const sqlPath = path.join(drizzleDir, `${plan.tag}.sql`);
    await writeFile(sqlPath, plan.sql, "utf8");

    const journalPath = path.join(metaDir, "_journal.json");
    const raw = await readFile(journalPath, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    const journal: DrizzleJournal = raw
      ? (JSON.parse(raw) as DrizzleJournal)
      : { version: "7", dialect: "postgresql", entries: [] };
    if (journal.entries.some((e) => e.tag === plan.tag)) return;
    const lastIdx = journal.entries.length
      ? journal.entries[journal.entries.length - 1].idx
      : -1;
    journal.entries.push({
      idx: lastIdx + 1,
      version: journal.version ?? "7",
      when: Date.now(),
      tag: plan.tag,
      breakpoints: true,
    });
    await writeFile(
      journalPath,
      `${JSON.stringify(journal, null, 2)}\n`,
      "utf8",
    );
  }

  private async tableExists(table: string): Promise<boolean> {
    const rows = await this.db.execute<{ exists: boolean }>(
      sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists`,
    );
    // drizzle's postgres-js execute returns the postgres result array directly.
    const first = (rows as unknown as Array<{ exists: boolean }>)[0];
    return !!first?.exists;
  }
}

// Best-effort inbox → typed-table migration. For each new_ingests entry, fetch
// inbox rows by id, project them via the proposal's field-mapping, INSERT into
// the target table, and flag the inbox rows with claimed_by_proposal_id.
export class PgInboxMigrator implements InboxMigrator {
  async migrate(
    tx: Tx,
    ingests: ProposalDiff["new_ingests"],
  ): Promise<number> {
    const entries = Object.values(ingests);
    if (entries.length === 0) return 0;
    let count = 0;
    await withTx(tx, async (drizzle) => {
      for (const ingest of entries) {
        if (!ingest.inbox_ids?.length) continue;
        const rows = (await drizzle
          .select()
          .from(inbox)
          .where(inArray(inbox.id, ingest.inbox_ids))) as InboxRow[];
        const targetTable = snakeCase(ingest.target_object_type);
        for (const r of rows) {
          const payload = (r.payload ?? {}) as Record<string, unknown>;
          const cols: string[] = [];
          const vals: unknown[] = [];
          for (const [src, dst] of Object.entries(ingest.mapping)) {
            cols.push(`"${snakeCase(dst)}"`);
            vals.push(payload[src] ?? null);
          }
          if (!cols.length) continue;
          const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
          await drizzle.execute(
            sql.raw(
              `INSERT INTO "${targetTable}" (${cols.join(", ")}) VALUES (${placeholders})`,
            ),
          );
          count++;
        }
        await drizzle
          .update(inbox)
          .set({ claimed_by_proposal_id: ingest.inbox_ids[0] })
          .where(inArray(inbox.id, ingest.inbox_ids));
      }
    });
    return count;
  }
}

// Flips proposals.status to 'approved' inside the supplied tx so the row
// transitions atomically with the schema changes that justify it.
export class PgProposalStatusStore implements ProposalStatusStore {
  async markApplied(tx: Tx, proposalId: string): Promise<void> {
    await withTx(tx, async (drizzle) => {
      await drizzle
        .update(proposalsTable)
        .set({ status: "approved" })
        .where(eq(proposalsTable.id, proposalId));
    });
  }
}

// Best-effort commit. If the runtime is a Docker container without a git
// working tree, swallow the failure — the audit row already records the
// apply, which is the load-bearing artifact. The yaml/codegen writes are
// already on the bind-mounted host volume.
export class BestEffortGitClient implements GitClient {
  constructor(private readonly cwd: string) {}

  async addAndCommit(
    message: string,
    paths: string[],
    attribution?: string,
  ): Promise<void> {
    if (paths.length === 0) return;
    const quoted = paths.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(" ");
    try {
      await execAsync(`git add ${quoted}`, { cwd: this.cwd });
      const author = attribution
        ? ` --author="${attribution.replace(/"/g, '\\"')}"`
        : "";
      const safeMsg = message.replace(/"/g, '\\"');
      await execAsync(`git commit -m "${safeMsg}"${author}`, { cwd: this.cwd });
    } catch {
      // No git tree, no commits matter, or hook refused. Apply already
      // succeeded at the DB + filesystem level — don't undo it.
    }
  }
}

// Wraps drizzle's transaction with an opaque tag and registers the real tx
// in the module-scoped registry so the migration/inbox/status adapters can
// reach it through the opaque Tx handle.
export class PgTransactionRunner implements TransactionRunner {
  constructor(private readonly db: Database) {}

  async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tag = randomUUID();
    try {
      return await this.db.transaction(async (drizzleTx) => {
        txRegistry.set(tag, drizzleTx as unknown as DrizzleTx);
        try {
          return await fn({ tag });
        } finally {
          txRegistry.delete(tag);
        }
      });
    } finally {
      txRegistry.delete(tag);
    }
  }
}

// Convenience: package up the AuditStore-shape that lib/audit/writer.ts
// exposes plus a YAML-friendly stringifier for the audit metadata.
export function debugYaml(v: unknown): string {
  return stringifyYaml(v);
}

function dbRowToAuditRow(row: {
  id: string;
  at: Date;
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

// PG-backed audit store. Writes hit the live `ontology_audit` /
// `action_audit` tables created by the 0001_audit migration.
export class PgAuditStore implements AuditStore {
  constructor(private readonly db: Database) {}

  async insertOntologyAudit(input: AuditEntryInput): Promise<AuditRow> {
    const [row] = await this.db
      .insert(ontology_audit)
      .values({
        actor: input.actor,
        actor_role: input.actor_role,
        via: input.via,
        subject_type: input.subject_type,
        subject_id: input.subject_id,
        before: input.before ?? null,
        after: input.after ?? null,
        metadata: (input.metadata ?? {}) as Record<string, unknown>,
      })
      .returning();
    return dbRowToAuditRow(row);
  }

  async insertActionAudit(input: AuditEntryInput): Promise<AuditRow> {
    const [row] = await this.db
      .insert(action_audit)
      .values({
        actor: input.actor,
        actor_role: input.actor_role,
        via: input.via,
        subject_type: input.subject_type,
        subject_id: input.subject_id,
        before: input.before ?? null,
        after: input.after ?? null,
        metadata: (input.metadata ?? {}) as Record<string, unknown>,
      })
      .returning();
    return dbRowToAuditRow(row);
  }

  async listOntologyAudit(): Promise<AuditRow[]> {
    const rows = await this.db
      .select()
      .from(ontology_audit)
      .orderBy(desc(ontology_audit.at));
    return rows.map(dbRowToAuditRow);
  }

  async listActionAudit(): Promise<AuditRow[]> {
    const rows = await this.db
      .select()
      .from(action_audit)
      .orderBy(desc(action_audit.at));
    return rows.map(dbRowToAuditRow);
  }
}
