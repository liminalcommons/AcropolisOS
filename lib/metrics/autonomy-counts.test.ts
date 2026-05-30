import { describe, expect, it } from "vitest";
import { autonomyCounts, autonomyRatio, type MetricAuditRow, type PolicyOf } from "./community-intelligence";

// check_in auto-applies; resolve_blocker is human (always_confirm); flag_blocker
// is the escalation action.
const policyOf: PolicyOf = (name) =>
  name === "check_in" ? "auto_apply" : name === "resolve_blocker" ? "always_confirm" : undefined;

const audits: MetricAuditRow[] = [
  { subject_type: "action", subject_id: "check_in", metadata: { result: "ok" } }, // auto
  { subject_type: "action", subject_id: "flag_blocker", metadata: { result: "ok" } }, // escalated
  { subject_type: "action", subject_id: "resolve_blocker", metadata: { result: "ok" } }, // always_confirm -> excluded
  { subject_type: "action", subject_id: "check_in", metadata: { result: "error" } }, // not ok -> excluded
  { subject_type: "note", subject_id: "check_in", metadata: { result: "ok" } }, // not an action -> excluded
];

describe("autonomyCounts", () => {
  it("counts ok auto_apply vs escalation actions, excluding human/error/non-action rows", () => {
    expect(autonomyCounts(audits, policyOf)).toEqual({ autoApplied: 1, escalated: 1 });
  });

  it("autonomyRatio is derived from the same counts", () => {
    expect(autonomyRatio(audits, policyOf)).toBe(0.5);
  });

  it("zero agent decisions -> {0,0} and a null ratio", () => {
    const none: MetricAuditRow[] = [{ subject_type: "action", subject_id: "resolve_blocker", metadata: { result: "ok" } }];
    expect(autonomyCounts(none, policyOf)).toEqual({ autoApplied: 0, escalated: 0 });
    expect(autonomyRatio(none, policyOf)).toBeNull();
  });
});
