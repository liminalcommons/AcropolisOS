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

describe("inbox migration", () => {
  it("appends an inbox entry after audit in the journal", async () => {
    const journal = await readJournal();
    const inboxEntry = journal.entries.find((e) => /inbox/i.test(e.tag));
    expect(inboxEntry).toBeDefined();
    expect(inboxEntry?.idx).toBe(2);
  });

  it("creates the inbox table with all required columns", async () => {
    const journal = await readJournal();
    const inboxEntry = journal.entries.find((e) => /inbox/i.test(e.tag));
    const sql = await readFile(
      path.join(migrationsDir, `${inboxEntry!.tag}.sql`),
      "utf8",
    );
    expect(sql).toMatch(/CREATE TABLE\s+"?inbox"?/i);
    expect(sql).toMatch(/"?id"?\s+uuid/i);
    expect(sql).toMatch(/"?at"?\s+timestamp/i);
    expect(sql).toMatch(/"?source_filename"?\s+text/i);
    expect(sql).toMatch(/"?mime_type"?\s+text/i);
    expect(sql).toMatch(/"?payload"?\s+jsonb/i);
    expect(sql).toMatch(/"?claimed_by_proposal_id"?\s+uuid/i);
  });

  it("ships a snapshot containing public.inbox", async () => {
    const journal = await readJournal();
    const inboxEntry = journal.entries.find((e) => /inbox/i.test(e.tag));
    const idx = String(inboxEntry!.idx).padStart(4, "0");
    const snapshotRaw = await readFile(
      path.join(migrationsDir, "meta", `${idx}_snapshot.json`),
      "utf8",
    );
    const snapshot = JSON.parse(snapshotRaw) as {
      tables: Record<string, unknown>;
    };
    expect(snapshot.tables["public.inbox"]).toBeDefined();
  });
});
