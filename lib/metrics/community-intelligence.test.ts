import { describe, expect, it } from "vitest";
import {
  autonomyRatio,
  scenarioAcceptanceRate,
  decisionLatencyMsMedian,
  coordinationCoverage,
  resolutionAccuracy,
  computeCommunityIntelligence,
  type MetricAuditRow,
  type MetricBlockerRow,
  type PolicyOf,
} from "./community-intelligence";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const AUTO: PolicyOf = (name) => {
  const map: Record<string, "auto_apply" | "always_confirm"> = {
    log_incident: "auto_apply",
    send_notification: "auto_apply",
    assign_bed: "always_confirm",
    evict_guest: "always_confirm",
  };
  return map[name];
};

// Fixed ISO timestamps for exact latency arithmetic
// t0 = 2026-01-01T00:00:00.000Z  → 1735689600000 ms
// t1 = 2026-01-01T01:00:00.000Z  → 1735693200000 ms  (delta = 3 600 000 ms)
// t2 = 2026-01-01T04:00:00.000Z  → 1735704000000 ms  (delta from t0 = 14 400 000 ms)
// t3 = 2026-01-01T09:00:00.000Z  → 1735722000000 ms  (delta from t0 = 32 400 000 ms)
const t0 = "2026-01-01T00:00:00.000Z";
const t1 = "2026-01-01T01:00:00.000Z";
const t2 = "2026-01-01T04:00:00.000Z";
const t3 = "2026-01-01T09:00:00.000Z";

const D_t0_t1 = Date.parse(t1) - Date.parse(t0); // 3_600_000
const D_t0_t2 = Date.parse(t2) - Date.parse(t0); // 14_400_000
const D_t0_t3 = Date.parse(t3) - Date.parse(t0); // 32_400_000

// ---------------------------------------------------------------------------
// 1. autonomyRatio
// ---------------------------------------------------------------------------

describe("autonomyRatio", () => {
  it("returns null for empty audits", () => {
    expect(autonomyRatio([], AUTO)).toBeNull();
  });

  it("returns null when all audits have non-action subject_type", () => {
    const audits: MetricAuditRow[] = [
      { subject_type: "event", subject_id: "log_incident", metadata: { result: "ok" } },
    ];
    expect(autonomyRatio(audits, AUTO)).toBeNull();
  });

  it("returns null when all ok-action rows have unknown policy", () => {
    const audits: MetricAuditRow[] = [
      { subject_type: "action", subject_id: "unknown_action", metadata: { result: "ok" } },
    ];
    expect(autonomyRatio(audits, AUTO)).toBeNull();
  });

  it("computes basic ratio: 2 auto_apply out of 3 known-policy ok actions → 2/3", () => {
    const audits: MetricAuditRow[] = [
      { subject_type: "action", subject_id: "log_incident",      metadata: { result: "ok" } }, // auto
      { subject_type: "action", subject_id: "send_notification", metadata: { result: "ok" } }, // auto
      { subject_type: "action", subject_id: "assign_bed",        metadata: { result: "ok" } }, // always_confirm
    ];
    const ratio = autonomyRatio(audits, AUTO);
    expect(ratio).not.toBeNull();
    expect(ratio).toBeCloseTo(2 / 3, 10);
  });

  it("excludes result=error rows", () => {
    const audits: MetricAuditRow[] = [
      { subject_type: "action", subject_id: "log_incident", metadata: { result: "ok" } },   // auto
      { subject_type: "action", subject_id: "log_incident", metadata: { result: "error" } }, // excluded
      { subject_type: "action", subject_id: "assign_bed",   metadata: { result: "ok" } },   // confirm
    ];
    // denominator = 2 (only ok rows with known policy)
    // numerator = 1 (log_incident auto)
    expect(autonomyRatio(audits, AUTO)).toBeCloseTo(1 / 2, 10);
  });

  it("excludes result=pending rows", () => {
    const audits: MetricAuditRow[] = [
      { subject_type: "action", subject_id: "log_incident", metadata: { result: "pending" } },
      { subject_type: "action", subject_id: "assign_bed",   metadata: { result: "ok" } },
    ];
    // only assign_bed ok → denominator 1, numerator 0
    expect(autonomyRatio(audits, AUTO)).toBeCloseTo(0, 10);
  });

  it("excludes result=replay rows", () => {
    const audits: MetricAuditRow[] = [
      { subject_type: "action", subject_id: "log_incident", metadata: { result: "replay" } },
      { subject_type: "action", subject_id: "log_incident", metadata: { result: "ok" } },
    ];
    // only 1 ok auto row
    expect(autonomyRatio(audits, AUTO)).toBeCloseTo(1, 10);
  });

  it("excludes rows with unknown policy even if result is ok", () => {
    const audits: MetricAuditRow[] = [
      { subject_type: "action", subject_id: "mystery_action", metadata: { result: "ok" } },
      { subject_type: "action", subject_id: "log_incident",   metadata: { result: "ok" } },
    ];
    // denominator = 1 (only log_incident has known policy)
    expect(autonomyRatio(audits, AUTO)).toBeCloseTo(1, 10);
  });

  it("returns 0 when all known-policy ok rows are always_confirm", () => {
    const audits: MetricAuditRow[] = [
      { subject_type: "action", subject_id: "assign_bed", metadata: { result: "ok" } },
      { subject_type: "action", subject_id: "evict_guest", metadata: { result: "ok" } },
    ];
    expect(autonomyRatio(audits, AUTO)).toBeCloseTo(0, 10);
  });
});

// ---------------------------------------------------------------------------
// 2. scenarioAcceptanceRate
// ---------------------------------------------------------------------------

describe("scenarioAcceptanceRate", () => {
  it("returns null for empty blockers", () => {
    expect(scenarioAcceptanceRate([])).toBeNull();
  });

  it("returns null when all blockers are open (no closed blockers)", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "open" },
      { status: "open" },
    ];
    expect(scenarioAcceptanceRate(blockers)).toBeNull();
  });

  it("computes basic ratio: 2 resolved out of 3 closed → 2/3", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "resolved" },
      { status: "resolved" },
      { status: "dismissed" },
    ];
    expect(scenarioAcceptanceRate(blockers)).toBeCloseTo(2 / 3, 10);
  });

  it("open blockers are excluded from the denominator", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "resolved" },
      { status: "open" },   // excluded
      { status: "open" },   // excluded
      { status: "expired" },
    ];
    // denominator = 2, numerator = 1
    expect(scenarioAcceptanceRate(blockers)).toBeCloseTo(1 / 2, 10);
  });

  it("counts expired in denominator but not numerator", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "expired" },
      { status: "expired" },
    ];
    expect(scenarioAcceptanceRate(blockers)).toBeCloseTo(0, 10);
  });

  it("returns 1.0 when all closed blockers are resolved", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "resolved" },
      { status: "resolved" },
    ];
    expect(scenarioAcceptanceRate(blockers)).toBeCloseTo(1, 10);
  });
});

// ---------------------------------------------------------------------------
// 3. decisionLatencyMsMediaian
// ---------------------------------------------------------------------------

describe("decisionLatencyMsMedian", () => {
  it("returns null for empty blockers", () => {
    expect(decisionLatencyMsMedian([])).toBeNull();
  });

  it("returns null when no blockers are resolved", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "open" },
      { status: "dismissed" },
    ];
    expect(decisionLatencyMsMedian(blockers)).toBeNull();
  });

  it("returns null when resolved blockers have no timestamps", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "resolved", created_at: null, resolved_at: null },
    ];
    expect(decisionLatencyMsMedian(blockers)).toBeNull();
  });

  it("returns null when created_at is missing", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "resolved", created_at: null, resolved_at: t1 },
    ];
    expect(decisionLatencyMsMedian(blockers)).toBeNull();
  });

  it("returns null when resolved_at is missing", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "resolved", created_at: t0, resolved_at: null },
    ];
    expect(decisionLatencyMsMedian(blockers)).toBeNull();
  });

  it("ignores rows where resolved_at < created_at (clock skew / data error)", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "resolved", created_at: t1, resolved_at: t0 }, // resolved before created — skip
      { status: "resolved", created_at: t0, resolved_at: t2 }, // valid: D_t0_t2
    ];
    expect(decisionLatencyMsMedian(blockers)).toBe(D_t0_t2);
  });

  it("computes single-element median (odd count)", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "resolved", created_at: t0, resolved_at: t1 },
    ];
    expect(decisionLatencyMsMedian(blockers)).toBe(D_t0_t1);
  });

  it("computes even-count median as average of two middle values", () => {
    // Latencies: D_t0_t1 = 3_600_000, D_t0_t2 = 14_400_000
    // Sorted: [3_600_000, 14_400_000] → median = (3_600_000 + 14_400_000) / 2 = 9_000_000
    const blockers: MetricBlockerRow[] = [
      { status: "resolved", created_at: t0, resolved_at: t1 },
      { status: "resolved", created_at: t0, resolved_at: t2 },
    ];
    expect(decisionLatencyMsMedian(blockers)).toBe((D_t0_t1 + D_t0_t2) / 2);
  });

  it("computes odd-count median (3 items → middle value)", () => {
    // Latencies: D_t0_t1=3_600_000, D_t0_t2=14_400_000, D_t0_t3=32_400_000
    // Sorted: [3_600_000, 14_400_000, 32_400_000] → median = 14_400_000
    const blockers: MetricBlockerRow[] = [
      { status: "resolved", created_at: t0, resolved_at: t3 },
      { status: "resolved", created_at: t0, resolved_at: t1 },
      { status: "resolved", created_at: t0, resolved_at: t2 },
    ];
    expect(decisionLatencyMsMedian(blockers)).toBe(D_t0_t2);
  });

  it("ignores non-resolved blockers even if they have timestamps", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "dismissed", created_at: t0, resolved_at: t1 },
      { status: "resolved",  created_at: t0, resolved_at: t2 },
    ];
    expect(decisionLatencyMsMedian(blockers)).toBe(D_t0_t2);
  });

  it("accepts zero latency (resolved_at === created_at)", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "resolved", created_at: t0, resolved_at: t0 },
    ];
    expect(decisionLatencyMsMedian(blockers)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. coordinationCoverage
// ---------------------------------------------------------------------------

describe("coordinationCoverage", () => {
  it("returns null for empty blockers", () => {
    expect(coordinationCoverage([])).toBeNull();
  });

  it("returns 0 when all blockers are open", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "open" },
      { status: "open" },
    ];
    expect(coordinationCoverage(blockers)).toBeCloseTo(0, 10);
  });

  it("returns 1 when all blockers are closed (no open)", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "resolved" },
      { status: "dismissed" },
      { status: "expired" },
    ];
    expect(coordinationCoverage(blockers)).toBeCloseTo(1, 10);
  });

  it("computes mixed ratio: 2 closed out of 4 total → 0.5", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "open" },
      { status: "open" },
      { status: "resolved" },
      { status: "dismissed" },
    ];
    expect(coordinationCoverage(blockers)).toBeCloseTo(0.5, 10);
  });

  it("treats dismissed and expired as closed (not open)", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "open" },
      { status: "expired" },
      { status: "dismissed" },
    ];
    // 2/3 closed
    expect(coordinationCoverage(blockers)).toBeCloseTo(2 / 3, 10);
  });
});

// ---------------------------------------------------------------------------
// 5. resolutionAccuracy
// ---------------------------------------------------------------------------

describe("resolutionAccuracy", () => {
  it("returns null for empty blockers", () => {
    expect(resolutionAccuracy([])).toBeNull();
  });

  it("returns null when no blockers are resolved", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "open" },
      { status: "dismissed" },
    ];
    expect(resolutionAccuracy(blockers)).toBeNull();
  });

  it("returns null when resolved blockers have no parseable resolved_at", () => {
    const blockers: MetricBlockerRow[] = [
      { status: "resolved", resolved_at: null },
    ];
    expect(resolutionAccuracy(blockers)).toBeNull();
  });

  it("returns 1.0 when no re-flags exist", () => {
    const blockers: MetricBlockerRow[] = [
      {
        status: "resolved",
        blocked_actor_id: "actor-1",
        reason_kind: "late_checkout",
        summary: "Room 101",
        created_at: t0,
        resolved_at: t1,
      },
    ];
    expect(resolutionAccuracy(blockers)).toBeCloseTo(1, 10);
  });

  it("marks a blocker as re-flagged when another with same triple is created AFTER resolved_at", () => {
    const blockers: MetricBlockerRow[] = [
      // First resolution
      {
        status: "resolved",
        blocked_actor_id: "actor-1",
        reason_kind: "late_checkout",
        summary: "Room 101",
        created_at: t0,
        resolved_at: t1,
      },
      // Re-flag: same triple, created AFTER t1
      {
        status: "open",
        blocked_actor_id: "actor-1",
        reason_kind: "late_checkout",
        summary: "Room 101",
        created_at: t2, // strictly after t1
      },
    ];
    // The resolved blocker is re-flagged → accuracy = 0
    expect(resolutionAccuracy(blockers)).toBeCloseTo(0, 10);
  });

  it("does NOT count a same-triple blocker created BEFORE resolved_at as a re-flag", () => {
    const blockers: MetricBlockerRow[] = [
      // A contemporaneous blocker (created before resolution)
      {
        status: "open",
        blocked_actor_id: "actor-1",
        reason_kind: "late_checkout",
        summary: "Room 101",
        created_at: t0, // same time as or before t1 resolution
      },
      {
        status: "resolved",
        blocked_actor_id: "actor-1",
        reason_kind: "late_checkout",
        summary: "Room 101",
        created_at: t0,
        resolved_at: t1,
      },
    ];
    // created_at of other = t0 which is NOT strictly after resolved_at t1
    expect(resolutionAccuracy(blockers)).toBeCloseTo(1, 10);
  });

  it("does NOT count a same-triple blocker created AT resolved_at as a re-flag (strict >)", () => {
    const blockers: MetricBlockerRow[] = [
      {
        status: "resolved",
        blocked_actor_id: "actor-2",
        reason_kind: "noise",
        summary: "Dorm B",
        created_at: t0,
        resolved_at: t1,
      },
      {
        status: "open",
        blocked_actor_id: "actor-2",
        reason_kind: "noise",
        summary: "Dorm B",
        created_at: t1, // equal to resolved_at — NOT strictly after
      },
    ];
    expect(resolutionAccuracy(blockers)).toBeCloseTo(1, 10);
  });

  it("computes mixed: 1 re-flagged, 1 accurate out of 2 resolved → 0.5", () => {
    const blockers: MetricBlockerRow[] = [
      // Resolved blocker that WILL be re-flagged
      {
        status: "resolved",
        blocked_actor_id: "actor-1",
        reason_kind: "late_checkout",
        summary: "Room 101",
        created_at: t0,
        resolved_at: t1,
      },
      // Re-flag for the first
      {
        status: "open",
        blocked_actor_id: "actor-1",
        reason_kind: "late_checkout",
        summary: "Room 101",
        created_at: t2, // strictly after t1
      },
      // Resolved blocker with different triple — NOT re-flagged
      {
        status: "resolved",
        blocked_actor_id: "actor-2",
        reason_kind: "noise",
        summary: "Dorm B",
        created_at: t0,
        resolved_at: t1,
      },
    ];
    // 1 accurate out of 2 resolved
    expect(resolutionAccuracy(blockers)).toBeCloseTo(0.5, 10);
  });

  it("different triple does not trigger re-flag", () => {
    const blockers: MetricBlockerRow[] = [
      {
        status: "resolved",
        blocked_actor_id: "actor-1",
        reason_kind: "late_checkout",
        summary: "Room 101",
        created_at: t0,
        resolved_at: t1,
      },
      // Different reason_kind → different triple
      {
        status: "open",
        blocked_actor_id: "actor-1",
        reason_kind: "noise",       // different
        summary: "Room 101",
        created_at: t2,
      },
    ];
    expect(resolutionAccuracy(blockers)).toBeCloseTo(1, 10);
  });

  it("handles null fields in triple (null === null counts as same triple)", () => {
    const blockers: MetricBlockerRow[] = [
      {
        status: "resolved",
        blocked_actor_id: null,
        reason_kind: null,
        summary: null,
        created_at: t0,
        resolved_at: t1,
      },
      // Re-flag: same triple (all null), created after t1
      {
        status: "open",
        blocked_actor_id: null,
        reason_kind: null,
        summary: null,
        created_at: t2,
      },
    ];
    expect(resolutionAccuracy(blockers)).toBeCloseTo(0, 10);
  });
});

// ---------------------------------------------------------------------------
// 6. computeCommunityIntelligence
// ---------------------------------------------------------------------------

describe("computeCommunityIntelligence", () => {
  it("returns all nulls for empty inputs", () => {
    const result = computeCommunityIntelligence([], [], AUTO);
    expect(result.autonomyRatio).toBeNull();
    expect(result.scenarioAcceptanceRate).toBeNull();
    expect(result.decisionLatencyMsMedian).toBeNull();
    expect(result.coordinationCoverage).toBeNull();
    expect(result.resolutionAccuracy).toBeNull();
  });

  it("aggregates all five KPIs correctly with realistic data", () => {
    const blockers: MetricBlockerRow[] = [
      // resolved, no re-flag
      {
        status: "resolved",
        blocked_actor_id: "actor-1",
        reason_kind: "late_checkout",
        summary: "Room 101",
        created_at: t0,
        resolved_at: t1,
      },
      // dismissed
      { status: "dismissed" },
      // open
      { status: "open" },
    ];

    const audits: MetricAuditRow[] = [
      { subject_type: "action", subject_id: "log_incident",      metadata: { result: "ok" } }, // auto
      { subject_type: "action", subject_id: "send_notification", metadata: { result: "ok" } }, // auto
      { subject_type: "action", subject_id: "assign_bed",        metadata: { result: "ok" } }, // confirm
    ];

    const result = computeCommunityIntelligence(blockers, audits, AUTO);

    // autonomyRatio: 2 auto / 3 known-ok = 2/3
    expect(result.autonomyRatio).toBeCloseTo(2 / 3, 10);

    // scenarioAcceptanceRate: 1 resolved / 2 closed = 0.5
    expect(result.scenarioAcceptanceRate).toBeCloseTo(0.5, 10);

    // decisionLatencyMsMedian: only 1 resolved → D_t0_t1
    expect(result.decisionLatencyMsMedian).toBe(D_t0_t1);

    // coordinationCoverage: 2 closed / 3 total = 2/3
    expect(result.coordinationCoverage).toBeCloseTo(2 / 3, 10);

    // resolutionAccuracy: 1 resolved, not re-flagged → 1
    expect(result.resolutionAccuracy).toBeCloseTo(1, 10);
  });
});
