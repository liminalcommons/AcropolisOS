import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(__dirname, "..", "..");
const migrationsDir = path.join(pkgRoot, "drizzle");

describe("initial migration", () => {
  it("creates the _meta table and is referenced in the journal", async () => {
    const journalRaw = await readFile(
      path.join(migrationsDir, "meta", "_journal.json"),
      "utf8",
    );
    const journal = JSON.parse(journalRaw) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string; breakpoints: boolean }>;
    };

    expect(journal.dialect).toBe("postgresql");
    expect(journal.entries.length).toBeGreaterThan(0);
    const first = journal.entries[0];
    expect(first.idx).toBe(0);

    const sqlPath = path.join(migrationsDir, `${first.tag}.sql`);
    const sql = await readFile(sqlPath, "utf8");
    expect(sql).toMatch(/CREATE TABLE\s+"?_meta"?/i);
    expect(sql).toMatch(/"?key"?\s+text/i);
  });

  it("guards Apache AGE extension creation behind pg_available_extensions", async () => {
    const journalRaw = await readFile(
      path.join(migrationsDir, "meta", "_journal.json"),
      "utf8",
    );
    const journal = JSON.parse(journalRaw) as {
      entries: Array<{ tag: string }>;
    };
    const sqls = await Promise.all(
      journal.entries.map((e) =>
        readFile(path.join(migrationsDir, `${e.tag}.sql`), "utf8"),
      ),
    );
    const combined = sqls.join("\n");

    expect(combined).toMatch(/pg_available_extensions/i);
    expect(combined).toMatch(/CREATE EXTENSION\s+IF NOT EXISTS\s+age/i);
  });
});
