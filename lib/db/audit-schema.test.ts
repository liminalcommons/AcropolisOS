import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { action_audit, ontology_audit } from "./schema";

const REQUIRED_COLUMNS = [
  "id",
  "at",
  "actor",
  "actor_role",
  "via",
  "subject_type",
  "subject_id",
  "before",
  "after",
  "metadata",
] as const;

describe("audit tables", () => {
  it("ontology_audit declares all required columns", () => {
    const config = getTableConfig(ontology_audit);
    expect(config.name).toBe("ontology_audit");
    const names = config.columns.map((c) => c.name);
    for (const col of REQUIRED_COLUMNS) {
      expect(names).toContain(col);
    }
  });

  it("action_audit declares all required columns", () => {
    const config = getTableConfig(action_audit);
    expect(config.name).toBe("action_audit");
    const names = config.columns.map((c) => c.name);
    for (const col of REQUIRED_COLUMNS) {
      expect(names).toContain(col);
    }
  });

  it.each([
    ["ontology_audit", ontology_audit],
    ["action_audit", action_audit],
  ] as const)("%s uses jsonb for before/after/metadata", (_name, table) => {
    const config = getTableConfig(table);
    const byName = Object.fromEntries(config.columns.map((c) => [c.name, c]));
    expect(byName.before.getSQLType()).toBe("jsonb");
    expect(byName.after.getSQLType()).toBe("jsonb");
    expect(byName.metadata.getSQLType()).toBe("jsonb");
    expect(byName.metadata.notNull).toBe(true);
  });

  it.each([
    ["ontology_audit", ontology_audit],
    ["action_audit", action_audit],
  ] as const)("%s id is a primary-key uuid", (_name, table) => {
    const config = getTableConfig(table);
    const id = config.columns.find((c) => c.name === "id");
    expect(id).toBeDefined();
    expect(id?.primary).toBe(true);
    expect(id?.getSQLType()).toBe("uuid");
  });

  it.each([
    ["ontology_audit", ontology_audit],
    ["action_audit", action_audit],
  ] as const)("%s at is a non-null timestamptz", (_name, table) => {
    const config = getTableConfig(table);
    const at = config.columns.find((c) => c.name === "at");
    expect(at?.notNull).toBe(true);
    expect(at?.getSQLType()).toBe("timestamp with time zone");
  });

  it.each([
    ["ontology_audit", ontology_audit],
    ["action_audit", action_audit],
  ] as const)(
    "%s actor/actor_role/via/subject_type/subject_id are non-null text",
    (_name, table) => {
      const config = getTableConfig(table);
      const byName = Object.fromEntries(config.columns.map((c) => [c.name, c]));
      for (const col of [
        "actor",
        "actor_role",
        "via",
        "subject_type",
        "subject_id",
      ]) {
        expect(byName[col].notNull).toBe(true);
        expect(byName[col].getSQLType()).toBe("text");
      }
    },
  );
});
