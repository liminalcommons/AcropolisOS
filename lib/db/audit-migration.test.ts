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

describe("audit migration", () => {
  it("appends an audit entry after the initial migration in the journal", async () => {
    const journal = await readJournal();
    expect(journal.entries.length).toBeGreaterThanOrEqual(2);
    const audit = journal.entries.find((e) => /audit/i.test(e.tag));
    expect(audit).toBeDefined();
    expect(audit?.idx).toBe(1);
  });

  it("creates ontology_audit and action_audit tables", async () => {
    const journal = await readJournal();
    const audit = journal.entries.find((e) => /audit/i.test(e.tag));
    expect(audit).toBeDefined();
    const sql = await readFile(
      path.join(migrationsDir, `${audit!.tag}.sql`),
      "utf8",
    );
    expect(sql).toMatch(/CREATE TABLE\s+"?ontology_audit"?/i);
    expect(sql).toMatch(/CREATE TABLE\s+"?action_audit"?/i);
  });

  it("declares jsonb columns for before, after, and metadata in both tables", async () => {
    const journal = await readJournal();
    const audit = journal.entries.find((e) => /audit/i.test(e.tag));
    const sql = await readFile(
      path.join(migrationsDir, `${audit!.tag}.sql`),
      "utf8",
    );
    const occurrences = (re: RegExp) => (sql.match(re) ?? []).length;
    // before, after, metadata × 2 tables = 6 jsonb columns
    expect(occurrences(/"?before"?\s+jsonb/gi)).toBe(2);
    expect(occurrences(/"?after"?\s+jsonb/gi)).toBe(2);
    expect(occurrences(/"?metadata"?\s+jsonb/gi)).toBe(2);
  });

  it("ships a corresponding snapshot containing both audit tables", async () => {
    const journal = await readJournal();
    const audit = journal.entries.find((e) => /audit/i.test(e.tag));
    const idx = String(audit!.idx).padStart(4, "0");
    const snapshotRaw = await readFile(
      path.join(migrationsDir, "meta", `${idx}_snapshot.json`),
      "utf8",
    );
    const snapshot = JSON.parse(snapshotRaw) as {
      tables: Record<string, unknown>;
    };
    expect(snapshot.tables["public.ontology_audit"]).toBeDefined();
    expect(snapshot.tables["public.action_audit"]).toBeDefined();
  });
});
