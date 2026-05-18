import { describe, expect, it } from "vitest";
import {
  filterAuditRows,
  filterDataAuditRows,
  type AuditFilter,
  type DataAuditFilter,
  type DataAuditRow,
} from "./reader";
import type { AuditRow } from "./writer";

function auditRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: overrides.id ?? "r1",
    at: overrides.at ?? new Date("2026-05-18T12:00:00Z"),
    actor: overrides.actor ?? "alice@example.com",
    actor_role: overrides.actor_role ?? "steward",
    via: overrides.via ?? "apply_proposal",
    subject_type: overrides.subject_type ?? "proposal",
    subject_id: overrides.subject_id ?? "p1",
    before: overrides.before ?? null,
    after: overrides.after ?? null,
    metadata: overrides.metadata ?? {},
  };
}

function dataRow(overrides: Partial<DataAuditRow> = {}): DataAuditRow {
  return {
    id: overrides.id ?? "d1",
    at: overrides.at ?? new Date("2026-05-18T12:00:00Z"),
    table_name: overrides.table_name ?? "member",
    row_id: overrides.row_id ?? "row-1",
    operation: overrides.operation ?? "INSERT",
    before: overrides.before ?? null,
    after: overrides.after ?? null,
    db_actor: overrides.db_actor ?? "acropolisos",
  };
}

describe("filterAuditRows", () => {
  const rows: AuditRow[] = [
    auditRow({
      id: "a",
      actor: "alice@example.com",
      subject_type: "proposal",
      at: new Date("2026-05-17T10:00:00Z"),
    }),
    auditRow({
      id: "b",
      actor: "bob@example.com",
      subject_type: "proposal",
      at: new Date("2026-05-18T10:00:00Z"),
    }),
    auditRow({
      id: "c",
      actor: "alice@example.com",
      subject_type: "object_type",
      at: new Date("2026-05-19T10:00:00Z"),
    }),
  ];

  it("returns all rows sorted by at descending when filter is empty", () => {
    // Audit semantics: most-recent first by default.
    expect(filterAuditRows(rows, {}).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("filters by actor (exact match), most-recent first", () => {
    const f: AuditFilter = { actor: "alice@example.com" };
    expect(filterAuditRows(rows, f).map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("filters by subject_type", () => {
    const f: AuditFilter = { subject_type: "object_type" };
    expect(filterAuditRows(rows, f).map((r) => r.id)).toEqual(["c"]);
  });

  it("filters by since (inclusive), most-recent first", () => {
    const f: AuditFilter = { since: new Date("2026-05-18T00:00:00Z") };
    expect(filterAuditRows(rows, f).map((r) => r.id)).toEqual(["c", "b"]);
  });

  it("filters by until (inclusive), most-recent first", () => {
    const f: AuditFilter = { until: new Date("2026-05-18T23:59:59Z") };
    expect(filterAuditRows(rows, f).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("combines filters with AND semantics", () => {
    const f: AuditFilter = {
      actor: "alice@example.com",
      since: new Date("2026-05-18T00:00:00Z"),
    };
    expect(filterAuditRows(rows, f).map((r) => r.id)).toEqual(["c"]);
  });

  it("respects limit and returns most-recent rows by `at` descending", () => {
    const f: AuditFilter = { limit: 2 };
    const result = filterAuditRows(rows, f);
    expect(result.map((r) => r.id)).toEqual(["c", "b"]);
  });
});

describe("filterDataAuditRows", () => {
  const rows: DataAuditRow[] = [
    dataRow({
      id: "d1",
      table_name: "member",
      operation: "INSERT",
      at: new Date("2026-05-17T10:00:00Z"),
    }),
    dataRow({
      id: "d2",
      table_name: "event",
      operation: "INSERT",
      at: new Date("2026-05-18T10:00:00Z"),
    }),
    dataRow({
      id: "d3",
      table_name: "member",
      operation: "UPDATE",
      row_id: "row-42",
      at: new Date("2026-05-19T10:00:00Z"),
    }),
  ];

  it("filters by table_name", () => {
    const f: DataAuditFilter = { table_name: "member" };
    expect(filterDataAuditRows(rows, f).map((r) => r.id).sort()).toEqual([
      "d1",
      "d3",
    ]);
  });

  it("filters by operation", () => {
    const f: DataAuditFilter = { operation: "UPDATE" };
    expect(filterDataAuditRows(rows, f).map((r) => r.id)).toEqual(["d3"]);
  });

  it("filters by row_id (exact match)", () => {
    const f: DataAuditFilter = { row_id: "row-42" };
    expect(filterDataAuditRows(rows, f).map((r) => r.id)).toEqual(["d3"]);
  });

  it("sorts by `at` descending and respects limit", () => {
    expect(filterDataAuditRows(rows, { limit: 2 }).map((r) => r.id)).toEqual([
      "d3",
      "d2",
    ]);
  });
});
