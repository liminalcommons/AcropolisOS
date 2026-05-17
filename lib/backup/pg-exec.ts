import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import postgres from "postgres";
import type { AuditRow } from "../audit/writer";

export type AuditTableName = "ontology_audit" | "action_audit";

export interface PgExec {
  dump(opts: { databaseUrl: string; outFile: string }): Promise<void>;
  restore(opts: { databaseUrl: string; inFile: string }): Promise<void>;
  listAudit(opts: {
    databaseUrl: string;
    table: AuditTableName;
  }): Promise<AuditRow[]>;
  insertAuditRows(opts: {
    databaseUrl: string;
    table: AuditTableName;
    rows: AuditRow[];
  }): Promise<number>;
}

interface ExecResult {
  code: number;
  stderr: string;
}

function runChild(
  cmd: string,
  args: string[],
  opts: { input?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stderr }));
    if (opts.input !== undefined) {
      child.stdin.end(opts.input);
    } else {
      child.stdin.end();
    }
  });
}

export function createDefaultPgExec(): PgExec {
  return {
    async dump({ databaseUrl, outFile }) {
      const { code, stderr } = await runChild(
        "pg_dump",
        ["--format=plain", "--no-owner", "--no-privileges", "--dbname", databaseUrl, "--file", outFile],
        {},
      );
      if (code !== 0) {
        throw new Error(`pg_dump failed (exit ${code}): ${stderr}`);
      }
    },
    async restore({ databaseUrl, inFile }) {
      const sql = await readFile(inFile, "utf8");
      const { code, stderr } = await runChild(
        "psql",
        ["--dbname", databaseUrl, "--single-transaction", "--set", "ON_ERROR_STOP=1"],
        { input: sql },
      );
      if (code !== 0) {
        throw new Error(`psql restore failed (exit ${code}): ${stderr}`);
      }
    },
    async listAudit({ databaseUrl, table }) {
      const sql = postgres(databaseUrl, { max: 1 });
      try {
        const rows = await sql.unsafe<AuditRowRaw[]>(
          `SELECT id, at, actor, actor_role, via, subject_type, subject_id, before, after, metadata FROM ${table} ORDER BY at ASC`,
        );
        return rows.map(rawToRow);
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
    async insertAuditRows({ databaseUrl, table, rows }) {
      if (rows.length === 0) return 0;
      const sql = postgres(databaseUrl, { max: 1 });
      try {
        let inserted = 0;
        for (const row of rows) {
          await sql.unsafe(
            `INSERT INTO ${table} (id, at, actor, actor_role, via, subject_type, subject_id, before, after, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
             ON CONFLICT (id) DO NOTHING`,
            [
              row.id,
              row.at.toISOString(),
              row.actor,
              row.actor_role,
              row.via,
              row.subject_type,
              row.subject_id,
              JSON.stringify(row.before),
              JSON.stringify(row.after),
              JSON.stringify(row.metadata ?? {}),
            ],
          );
          inserted += 1;
        }
        return inserted;
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
  };
}

interface AuditRowRaw {
  id: string;
  at: Date;
  actor: string;
  actor_role: string;
  via: string;
  subject_type: string;
  subject_id: string;
  before: unknown | null;
  after: unknown | null;
  metadata: Record<string, unknown> | null;
}

function rawToRow(r: AuditRowRaw): AuditRow {
  return {
    id: r.id,
    at: r.at instanceof Date ? r.at : new Date(r.at),
    actor: r.actor,
    actor_role: r.actor_role,
    via: r.via,
    subject_type: r.subject_type,
    subject_id: r.subject_id,
    before: r.before ?? null,
    after: r.after ?? null,
    metadata: r.metadata ?? {},
  };
}

export async function readDbSql(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function writeDbSql(path: string, sql: string): Promise<void> {
  await writeFile(path, sql);
}
