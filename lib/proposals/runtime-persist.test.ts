import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiffMigrationRunner } from "./adapters/runtime";
import type { ProposalDiff } from "./diff";

// Fixtures live inside the package tree per [[gotcha-vitest-vite-fixture-root]]
// (vite refuses dynamic imports outside its project root).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_BASE = path.resolve(__dirname, "..", "..", ".tmp");

function fakeDiff(): ProposalDiff {
  return {
    new_object_types: {},
    new_link_types: {},
    new_shared_properties: {},
    modified_properties: {},
    new_action_types: {},
    new_functions: {},
    new_view_configs: {},
    new_seeds: {},
    new_ingests: {},
    evidence: {},
    impacted_tables: [],
  };
}

describe("DiffMigrationRunner.persist", () => {
  let pkgRoot: string;
  let journalPath: string;
  let drizzleDir: string;

  beforeEach(async () => {
    await mkdir(FIXTURE_BASE, { recursive: true });
    pkgRoot = await mkdtemp(path.join(FIXTURE_BASE, "drr-"));
    drizzleDir = path.join(pkgRoot, "drizzle");
    await mkdir(path.join(drizzleDir, "meta"), { recursive: true });
    journalPath = path.join(drizzleDir, "meta", "_journal.json");
    await writeFile(
      journalPath,
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          {
            idx: 0,
            version: "7",
            when: 1700000000000,
            tag: "0000_init",
            breakpoints: true,
          },
        ],
      }),
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(pkgRoot, { recursive: true, force: true });
  });

  it("writes drizzle/<tag>.sql with the plan's SQL content", async () => {
    const runner = new DiffMigrationRunner(
      fakeDiff(),
      null as never,
      pkgRoot,
    );
    await runner.persist({
      sql: 'ALTER TABLE "member" ADD COLUMN "pronouns" text;',
      tag: "proposal_20260518211519",
    });
    const sqlContent = await readFile(
      path.join(drizzleDir, "proposal_20260518211519.sql"),
      "utf8",
    );
    expect(sqlContent).toBe(
      'ALTER TABLE "member" ADD COLUMN "pronouns" text;',
    );
  });

  it("appends a new entry to drizzle/meta/_journal.json", async () => {
    const runner = new DiffMigrationRunner(fakeDiff(), null as never, pkgRoot);
    await runner.persist({
      sql: 'ALTER TABLE "m" ADD COLUMN "x" text;',
      tag: "proposal_20260518A",
    });
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      version: string;
      dialect: string;
      entries: Array<{
        idx: number;
        version: string;
        when: number;
        tag: string;
        breakpoints: boolean;
      }>;
    };
    expect(journal.entries).toHaveLength(2);
    expect(journal.entries[1].idx).toBe(1);
    expect(journal.entries[1].tag).toBe("proposal_20260518A");
    expect(journal.entries[1].version).toBe("7");
    expect(journal.entries[1].breakpoints).toBe(true);
    expect(typeof journal.entries[1].when).toBe("number");
  });

  it("is idempotent — re-running for same tag does not duplicate entries or files", async () => {
    const runner = new DiffMigrationRunner(fakeDiff(), null as never, pkgRoot);
    const plan = {
      sql: 'ALTER TABLE "m" ADD COLUMN "x" text;',
      tag: "proposal_20260518B",
    };
    await runner.persist(plan);
    await runner.persist(plan);
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const occurrences = journal.entries.filter(
      (e) => e.tag === "proposal_20260518B",
    );
    expect(occurrences).toHaveLength(1);
  });

  it("skips writes when the plan SQL is empty", async () => {
    const runner = new DiffMigrationRunner(fakeDiff(), null as never, pkgRoot);
    await runner.persist({ sql: "   ", tag: "proposal_noop" });
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    expect(journal.entries.find((e) => e.tag === "proposal_noop")).toBeUndefined();
  });

  it("creates the meta/_journal.json file if it doesn't exist yet", async () => {
    await rm(journalPath, { force: true });
    const runner = new DiffMigrationRunner(fakeDiff(), null as never, pkgRoot);
    await runner.persist({
      sql: "ALTER TABLE m ADD COLUMN x text;",
      tag: "proposal_seed",
    });
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.dialect).toBe("postgresql");
    expect(journal.entries).toEqual([
      expect.objectContaining({ idx: 0, tag: "proposal_seed" }),
    ]);
  });
});
