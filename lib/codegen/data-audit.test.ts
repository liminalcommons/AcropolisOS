import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOntology } from "../ontology/load";
import {
  DATA_AUDIT_TABLE_DDL,
  generateDataAuditMigration,
  generateTriggerDDL,
} from "./data-audit";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SMALL_COMMUNITY = path.join(
  PKG_ROOT,
  "seed",
  "small-community",
  "ontology",
);

describe("DATA_AUDIT_TABLE_DDL", () => {
  it("declares the generic data_audit table with the required columns", () => {
    expect(DATA_AUDIT_TABLE_DDL).toMatch(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?data_audit"?/i,
    );
    expect(DATA_AUDIT_TABLE_DDL).toMatch(/"?id"?\s+uuid/i);
    expect(DATA_AUDIT_TABLE_DDL).toMatch(/"?at"?\s+timestamp/i);
    expect(DATA_AUDIT_TABLE_DDL).toMatch(/"?table_name"?\s+text/i);
    expect(DATA_AUDIT_TABLE_DDL).toMatch(/"?row_id"?\s+text/i);
    expect(DATA_AUDIT_TABLE_DDL).toMatch(/"?operation"?\s+text/i);
    expect(DATA_AUDIT_TABLE_DDL).toMatch(/"?before"?\s+jsonb/i);
    expect(DATA_AUDIT_TABLE_DDL).toMatch(/"?after"?\s+jsonb/i);
    expect(DATA_AUDIT_TABLE_DDL).toMatch(/"?db_actor"?\s+text/i);
  });

  it("revokes UPDATE and DELETE to keep data_audit append-only", () => {
    expect(DATA_AUDIT_TABLE_DDL).toMatch(
      /REVOKE\s+UPDATE,\s*DELETE\s+ON\s+"?data_audit"?\s+FROM\s+PUBLIC/i,
    );
  });
});

describe("generateTriggerDDL", () => {
  it("emits a CREATE FUNCTION and CREATE TRIGGER for the given table", () => {
    const sql = generateTriggerDDL("member");
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION\s+"?member_data_audit_fn"?/i);
    expect(sql).toMatch(/CREATE TRIGGER\s+"?member_data_audit_trg"?/i);
    expect(sql).toMatch(/ON\s+"?member"?/i);
    expect(sql).toMatch(/AFTER\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE/i);
    expect(sql).toMatch(/FOR EACH ROW/i);
  });

  it("writes to the data_audit table inside the trigger function", () => {
    const sql = generateTriggerDDL("member");
    expect(sql).toMatch(/INSERT\s+INTO\s+"?data_audit"?/i);
  });

  it("captures row_to_jsonb(OLD) for UPDATE and DELETE, row_to_jsonb(NEW) for INSERT and UPDATE", () => {
    const sql = generateTriggerDDL("member");
    // before column should reference OLD (UPDATE/DELETE)
    expect(sql).toMatch(/row_to_jsonb\(OLD\)/);
    // after column should reference NEW (INSERT/UPDATE)
    expect(sql).toMatch(/row_to_jsonb\(NEW\)/);
    // distinguishes all three operations
    expect(sql).toMatch(/TG_OP\s*=\s*'INSERT'/);
    expect(sql).toMatch(/TG_OP\s*=\s*'UPDATE'/);
    expect(sql).toMatch(/TG_OP\s*=\s*'DELETE'/);
  });

  it("records the table name and primary key id in each audit row", () => {
    const sql = generateTriggerDDL("member");
    expect(sql).toMatch(/'member'/);
    expect(sql).toMatch(/COALESCE\(NEW\.id,\s*OLD\.id\)/i);
  });

  it("captures current_user as db_actor", () => {
    const sql = generateTriggerDDL("member");
    expect(sql).toMatch(/current_user/i);
  });

  it("returns the same SQL across repeat invocations (deterministic)", () => {
    expect(generateTriggerDDL("member")).toBe(generateTriggerDDL("member"));
  });
});

describe("generateDataAuditMigration", () => {
  it("returns SQL containing the data_audit table DDL", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const sql = generateDataAuditMigration(onto);
    expect(sql).toMatch(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?data_audit"?/i);
  });

  it("emits trigger DDL only for object types with data_audit: true", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const sql = generateDataAuditMigration(onto);
    // Member has data_audit: true in the seed
    expect(sql).toMatch(/CREATE TRIGGER\s+"?member_data_audit_trg"?/i);
    // Event/MeetingMinute do not — no triggers should be generated for them
    expect(sql).not.toMatch(/CREATE TRIGGER\s+"?event_data_audit_trg"?/i);
    expect(sql).not.toMatch(
      /CREATE TRIGGER\s+"?meeting_minute_data_audit_trg"?/i,
    );
  });

  it("emits an empty-but-valid string when no object type opts in", () => {
    const sql = generateDataAuditMigration({
      properties: {},
      roles: {},
      object_types: {
        Public: {
          properties: {
            id: { type: "uuid", primary_key: true },
          },
        },
      },
      link_types: {},
      action_types: {},
    });
    // table still created, but no triggers
    expect(sql).toMatch(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?data_audit"?/i);
    expect(sql).not.toMatch(/CREATE TRIGGER/i);
  });

  it("statements are separated by drizzle-style breakpoints", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const sql = generateDataAuditMigration(onto);
    expect(sql).toMatch(/--> statement-breakpoint/);
  });

  it("is deterministic across repeat invocations", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    expect(generateDataAuditMigration(onto)).toBe(
      generateDataAuditMigration(onto),
    );
  });
});
