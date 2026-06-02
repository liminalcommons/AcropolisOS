// Locks the empty-vs-ok rule the seam uses to set status: a metric is NEVER
// "empty" (a count of 0 is a valid measurement), the collection kinds are empty
// only when their backing array/map is empty. Pure — no IO.
import { describe, it, expect } from "vitest";
import { isEmptyWidgetData } from "./compose";

describe("isEmptyWidgetData", () => {
  it("metric / intelligence_metric are never empty", () => {
    expect(isEmptyWidgetData("metric", { value: 0, label: "x" })).toBe(false);
    expect(isEmptyWidgetData("intelligence_metric", { value: 0, label: "x", display: "0%" })).toBe(false);
  });
  it("data_table: empty iff no rows", () => {
    expect(isEmptyWidgetData("data_table", { columns: ["a"], rows: [] })).toBe(true);
    expect(isEmptyWidgetData("data_table", { columns: ["a"], rows: [{ a: 1 }] })).toBe(false);
  });
  it("roster: empty iff no entries", () => {
    expect(isEmptyWidgetData("roster", { fields: ["a"], entries: [] })).toBe(true);
    expect(isEmptyWidgetData("roster", { fields: ["a"], entries: [{ a: 1 }] })).toBe(false);
  });
  it("calendar: empty iff no buckets", () => {
    expect(isEmptyWidgetData("calendar", { date_field: "d", buckets: {} })).toBe(true);
    expect(isEmptyWidgetData("calendar", { date_field: "d", buckets: { "2026-01": [{}] } })).toBe(false);
  });
});
