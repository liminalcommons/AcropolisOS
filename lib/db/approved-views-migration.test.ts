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
