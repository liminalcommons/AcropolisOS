// lib/db/approved-views-migration.test.ts
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import path from "node:path";

const SQL = readFileSync(
  path.resolve(__dirname, "..", "..", "drizzle", "0008_approved_views.sql"),
  "utf8",
);

describe("0008_approved_views migration", () => {
  it("creates approved_views with scope, scope_key, descriptors, audit cols", () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS "approved_views"/);
    expect(SQL).toMatch(/"scope" text NOT NULL/);
    expect(SQL).toMatch(/"scope_key" text NOT NULL/);
    expect(SQL).toMatch(/"descriptors" jsonb NOT NULL/);
    expect(SQL).toMatch(/"created_by" text NOT NULL/);
    // one active view per (scope, scope_key)
    expect(SQL).toMatch(/UNIQUE.*"scope".*"scope_key"/s);
  });

  it("schema.ts exports the approved_views drizzle table", async () => {
    const mod = await import("./schema");
    expect(mod.approved_views).toBeDefined();
    // drizzle-orm 0.45.x stores columns under a Symbol, not a `._` getter;
    // getTableColumns is the supported public accessor for the column map.
    const cols = Object.keys(getTableColumns(mod.approved_views));
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "scope",
        "scope_key",
        "descriptors",
        "created_by",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("the schema.ts builder declares the (scope, scope_key) unique constraint matching the migration NAME — so a future drizzle-kit generate cannot DROP it", async () => {
    const mod = await import("./schema");
    const config = getTableConfig(mod.approved_views);
    const unique = config.uniqueConstraints.find(
      (u) => u.name === "approved_views_scope_key_unique",
    );
    expect(unique).toBeDefined();
    expect(unique!.columns.map((c) => c.name).sort()).toEqual(["scope", "scope_key"]);
  });
});

// BOOT WIRING — the gap that made this table silently absent in production.
//
// The migration file + schema export above can ALL be correct while the table
// is missing from the live DB: `drizzle-kit push` skips creating a brand-new
// table on non-TTY stdin (it cannot answer its own "is this a rename of X?"
// prompt), exits 0, and the app boots without approved_views. The hand-rolled
// CREATE TABLE IF NOT EXISTS only sidesteps that prompt if docker-entrypoint.sh
// actually APPLIES it BEFORE push — and only stays applied if post-push
// verification would FAIL LOUD when the table is absent. These assertions pin
// both, so the file existing can never again imply the table exists.
const ENTRYPOINT = readFileSync(
  path.resolve(__dirname, "..", "..", "docker-entrypoint.sh"),
  "utf8",
);

describe("docker-entrypoint boot wiring for approved_views", () => {
  it("pre-applies 0008_approved_views.sql before drizzle-kit push (sidesteps the rename prompt)", () => {
    const preApplyMatch = ENTRYPOINT.match(/for SQL in ([^\n]*)/);
    expect(preApplyMatch, "entrypoint must have a pre-apply SQL loop").toBeTruthy();
    expect(preApplyMatch![1]).toMatch(/drizzle\/0008_approved_views\.sql/);
  });

  it("verifies approved_views post-push so a silent skip becomes a hard boot failure", () => {
    // A check_column on approved_views — without it, a skipped push exits 0 and
    // the governance-view registry is silently lost (proposals fail to persist).
    expect(ENTRYPOINT).toMatch(/check_column\s+"approved_views"/);
  });
});
