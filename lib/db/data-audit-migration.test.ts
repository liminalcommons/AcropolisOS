import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(__dirname, "..", "..");
const migrationsDir = path.join(pkgRoot, "drizzle");

interface JournalEntry {
  idx: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

async function readJournal(): Promise<Journal> {
  const raw = await readFile(
    path.join(migrationsDir, "meta", "_journal.json"),
    "utf8",
  );
  return JSON.parse(raw) as Journal;
}

async function readDataAuditMigration(): Promise<string> {
  const journal = await readJournal();
  const entry = journal.entries.find((e) => /data[-_]?audit/i.test(e.tag));
  if (!entry) {
    throw new Error("expected a data_audit migration in the journal");
  }
  return readFile(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
}

describe("data_audit migration", () => {
  it("appears in the journal after the inbox migration", async () => {
    const journal = await readJournal();
    const dataAudit = journal.entries.find((e) =>
      /data[-_]?audit/i.test(e.tag),
    );
    expect(dataAudit).toBeDefined();
    expect(dataAudit!.idx).toBeGreaterThanOrEqual(3);
  });

  it("creates the data_audit table with all required columns", async () => {
    const sql = await readDataAuditMigration();
    expect(sql).toMatch(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?data_audit"?/i,
    );
    expect(sql).toMatch(/"?id"?\s+uuid/i);
    expect(sql).toMatch(/"?at"?\s+timestamp/i);
    expect(sql).toMatch(/"?table_name"?\s+text/i);
    expect(sql).toMatch(/"?row_id"?\s+text/i);
    expect(sql).toMatch(/"?operation"?\s+text/i);
    expect(sql).toMatch(/"?before"?\s+jsonb/i);
    expect(sql).toMatch(/"?after"?\s+jsonb/i);
    expect(sql).toMatch(/"?db_actor"?\s+text/i);
  });

  it("revokes UPDATE/DELETE on data_audit so it stays append-only", async () => {
    const sql = await readDataAuditMigration();
    expect(sql).toMatch(
      /REVOKE\s+UPDATE,\s*DELETE\s+ON\s+"?data_audit"?\s+FROM\s+PUBLIC/i,
    );
  });

  it("creates a trigger on the member table (data_audit: true in seed)", async () => {
    const sql = await readDataAuditMigration();
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION\s+"?member_data_audit_fn"?/i);
    expect(sql).toMatch(/CREATE TRIGGER\s+"?member_data_audit_trg"?/i);
    expect(sql).toMatch(/ON\s+"?member"?/i);
    expect(sql).toMatch(/AFTER\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE/i);
  });

  it("does NOT create triggers for object types without data_audit (event, meeting_minute)", async () => {
    const sql = await readDataAuditMigration();
    expect(sql).not.toMatch(/CREATE TRIGGER\s+"?event_data_audit_trg"?/i);
    expect(sql).not.toMatch(
      /CREATE TRIGGER\s+"?meeting_minute_data_audit_trg"?/i,
    );
  });
});
