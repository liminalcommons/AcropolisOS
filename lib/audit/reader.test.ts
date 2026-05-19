import { describe, expect, it } from "vitest";
import {
  buildActionChain,
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

describe("buildActionChain — M2.5 action-composition reader", () => {
  // A composing action's audit log is a tree (parent → many children,
  // grandchildren, …). buildActionChain takes a root id and returns the
  // flattened depth-tagged subtree rooted at that id.
  //
  // The link is `metadata.parent_action_audit_id` — same field side-effects
  // (M2.4) AND ctx.actions.X composition write.

  function row(
    id: string,
    parentId: string | undefined,
    at: string,
    subject_id = "action",
  ): AuditRow {
    return auditRow({
      id,
      at: new Date(at),
      subject_id,
      metadata: parentId
        ? { result: "ok", parent_action_audit_id: parentId }
        : { result: "ok" },
    });
  }

  it("returns a single-row chain for a leaf with no children", () => {
    const all = [row("root", undefined, "2026-05-18T10:00:00Z")];
    const chain = buildActionChain(all, "root");
    expect(chain.map((c) => ({ id: c.row.id, depth: c.depth }))).toEqual([
      { id: "root", depth: 0 },
    ]);
  });

  it("walks 3 generations: root → child → grandchild", () => {
    const all = [
      row("root", undefined, "2026-05-18T10:00:00Z", "promote"),
      row("child", "root", "2026-05-18T10:00:01Z", "change_tier"),
      row("grandchild", "child", "2026-05-18T10:00:02Z", "notify"),
    ];
    const chain = buildActionChain(all, "root");
    expect(chain.map((c) => ({ id: c.row.id, depth: c.depth }))).toEqual([
      { id: "root", depth: 0 },
      { id: "child", depth: 1 },
      { id: "grandchild", depth: 2 },
    ]);
  });

  it("orders siblings by `at` ascending so the chain reads top-to-bottom", () => {
    const all = [
      row("root", undefined, "2026-05-18T10:00:00Z"),
      row("late", "root", "2026-05-18T10:00:05Z"),
      row("early", "root", "2026-05-18T10:00:01Z"),
    ];
    const chain = buildActionChain(all, "root");
    expect(chain.map((c) => c.row.id)).toEqual(["root", "early", "late"]);
  });

  it("ignores unrelated rows (different root)", () => {
    const all = [
      row("a", undefined, "2026-05-18T10:00:00Z"),
      row("b", undefined, "2026-05-18T10:00:01Z"),
      row("a-child", "a", "2026-05-18T10:00:02Z"),
      row("b-child", "b", "2026-05-18T10:00:03Z"),
    ];
    const chain = buildActionChain(all, "a");
    expect(chain.map((c) => c.row.id).sort()).toEqual(["a", "a-child"]);
  });

  it("returns empty when the root id isn't found", () => {
    const all = [row("a", undefined, "2026-05-18T10:00:00Z")];
    expect(buildActionChain(all, "missing")).toEqual([]);
  });

  it("survives a cycle without infinite-looping", () => {
    // Defensive: real composition can't produce cycles (parent rows are
    // written before children), but a corrupt DB shouldn't hang the UI.
    const all = [
      row("a", "b", "2026-05-18T10:00:00Z"),
      row("b", "a", "2026-05-18T10:00:01Z"),
    ];
    const chain = buildActionChain(all, "a");
    // a is the requested root; b is a's descendant; if traversal recursed
    // back into a it would loop. We assert the visited set caps it.
    expect(chain.length).toBeLessThanOrEqual(2);
    expect(chain[0].row.id).toBe("a");
  });
});
