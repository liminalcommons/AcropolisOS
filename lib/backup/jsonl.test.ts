import { describe, expect, it } from "vitest";
import type { AuditRow } from "../audit/writer";
import { parseAuditJsonl, serializeAuditJsonl } from "./jsonl";

const sampleRow: AuditRow = {
  id: "11111111-1111-1111-1111-111111111111",
  at: new Date("2026-05-17T10:00:00.000Z"),
  actor: "user-1",
  actor_role: "steward",
  via: "proposal",
  subject_type: "object_type",
  subject_id: "Thread",
  before: null,
  after: { description: "new" },
  metadata: { proposal_id: "p-1" },
};

describe("serializeAuditJsonl", () => {
  it("emits one row per line with ISO timestamp", () => {
    const out = serializeAuditJsonl([sampleRow]);
    expect(out.endsWith("\n")).toBe(true);
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe(sampleRow.id);
    expect(parsed.at).toBe("2026-05-17T10:00:00.000Z");
    expect(parsed.actor_role).toBe("steward");
    expect(parsed.before).toBeNull();
    expect(parsed.after).toEqual({ description: "new" });
    expect(parsed.metadata).toEqual({ proposal_id: "p-1" });
  });

  it("returns an empty string for an empty array", () => {
    expect(serializeAuditJsonl([])).toBe("");
  });
});

describe("parseAuditJsonl", () => {
  it("reverses serializeAuditJsonl", () => {
    const jsonl = serializeAuditJsonl([sampleRow]);
    const rows = parseAuditJsonl(jsonl);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(sampleRow.id);
    expect(rows[0].at).toBeInstanceOf(Date);
    expect(rows[0].at.toISOString()).toBe(sampleRow.at.toISOString());
    expect(rows[0].subject_id).toBe("Thread");
    expect(rows[0].after).toEqual({ description: "new" });
  });

  it("tolerates a trailing newline and empty lines", () => {
    const jsonl = serializeAuditJsonl([sampleRow, sampleRow]) + "\n\n";
    const rows = parseAuditJsonl(jsonl);
    expect(rows).toHaveLength(2);
  });

  it("returns empty list for empty input", () => {
    expect(parseAuditJsonl("")).toEqual([]);
    expect(parseAuditJsonl("\n")).toEqual([]);
  });
});
