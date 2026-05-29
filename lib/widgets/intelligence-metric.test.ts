// intelligence_metric — the VETTED community-intelligence KPI widget kind.
//
// Proves the four queryBindings compose the pure metrics core over agent_blocker
// rows fetched through a ReadOnlyDataApi, returning both the raw `value` and a
// pre-formatted `display`. Deterministic: a FAKE ReadOnlyDataApi returns a fixed
// set of MetricBlockerRow-shaped rows — no DB, no I/O, hand-computed expectations.
//
// Fail-closed proof: an api returning rows:[] (the unauthorized/empty case)
// makes every KPI compute null → value 0, display "—" (no leak).

import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { WIDGET_CATALOG, validateWidgetConfig } from "./catalog";
import type { ReadOnlyDataApi } from "./read-api";
import { loadOntology } from "@/lib/ontology/load";
import type { Ontology } from "@/lib/ontology/schema";

// ── Fixture rows ───────────────────────────────────────────────────────────────
// Two resolved (with created_at/resolved_at), one open, one dismissed.
// Latencies for the two resolved: 10 min and 30 min → median 20 min = 1_200_000 ms.
// Acceptance: closed = {resolved, resolved, dismissed} = 3; resolved = 2 → 2/3 ≈ 0.667.
// Coverage: closed (status != open) = 3 of 4 total → 0.75.
// Accuracy: 2 eligible resolved, neither re-flagged (distinct triples) → 1.0.
const FIXTURE_ROWS: Record<string, unknown>[] = [
  {
    id: "b1",
    status: "resolved",
    created_at: "2026-05-01T10:00:00.000Z",
    resolved_at: "2026-05-01T10:10:00.000Z", // +10 min
    reason_kind: "policy_gap",
    blocked_actor_id: "agent-a",
    summary: "needs decision A",
  },
  {
    id: "b2",
    status: "resolved",
    created_at: "2026-05-01T11:00:00.000Z",
    resolved_at: "2026-05-01T11:30:00.000Z", // +30 min
    reason_kind: "policy_gap",
    blocked_actor_id: "agent-b",
    summary: "needs decision B",
  },
  {
    id: "b3",
    status: "open",
    created_at: "2026-05-02T09:00:00.000Z",
    resolved_at: null,
    reason_kind: "ambiguous",
    blocked_actor_id: "agent-c",
    summary: "still pending",
  },
  {
    id: "b4",
    status: "dismissed",
    created_at: "2026-05-02T08:00:00.000Z",
    resolved_at: null,
    reason_kind: "noise",
    blocked_actor_id: "agent-d",
    summary: "false alarm",
  },
];

// ── Fake ReadOnlyDataApi ─────────────────────────────────────────────────────────
// Only select() is exercised by intelligence_metric; the other methods throw so
// any accidental use is caught. select returns the supplied rows for
// agent_blocker, echoing back the requested columns.
function makeFakeApi(rows: Record<string, unknown>[]): ReadOnlyDataApi {
  return {
    async select(type, { columns }) {
      if (type !== "agent_blocker") return { columns: [], rows: [] };
      return { columns, rows };
    },
    async count() {
      throw new Error("count() not expected for intelligence_metric");
    },
    async selectByIds() {
      throw new Error("selectByIds() not expected for intelligence_metric");
    },
    async byDate() {
      throw new Error("byDate() not expected for intelligence_metric");
    },
  };
}

const entry = WIDGET_CATALOG.intelligence_metric;

describe("intelligence_metric — KPI queryBindings (populated rows)", () => {
  const api = makeFakeApi(FIXTURE_ROWS);

  it("scenario_acceptance → 2/3 resolved, display 67%", async () => {
    const data = await entry.queryBinding({ metric: "scenario_acceptance" }, api);
    expect(data.value).toBeCloseTo(2 / 3, 6);
    expect(data.display).toBe("67%");
    expect(data.label).toBe("Scenario acceptance");
  });

  it("decision_latency → median 20 min, display 20m", async () => {
    const data = await entry.queryBinding({ metric: "decision_latency" }, api);
    expect(data.value).toBe(20 * 60 * 1000); // 1_200_000 ms
    expect(data.display).toBe("20m");
    expect(data.label).toBe("Decision latency");
  });

  it("coordination_coverage → 3/4 addressed, display 75%", async () => {
    const data = await entry.queryBinding({ metric: "coordination_coverage" }, api);
    expect(data.value).toBe(0.75);
    expect(data.display).toBe("75%");
    expect(data.label).toBe("Coordination coverage");
  });

  it("resolution_accuracy → 2/2 held, display 100%", async () => {
    const data = await entry.queryBinding({ metric: "resolution_accuracy" }, api);
    expect(data.value).toBe(1);
    expect(data.display).toBe("100%");
    expect(data.label).toBe("Resolution accuracy");
  });
});

describe("intelligence_metric — fail-closed (empty rows ⇒ value 0, display —)", () => {
  const api = makeFakeApi([]);

  for (const metric of [
    "scenario_acceptance",
    "decision_latency",
    "coordination_coverage",
    "resolution_accuracy",
  ] as const) {
    it(`${metric} → value 0, display "—" on empty/unauthorized read`, async () => {
      const data = await entry.queryBinding({ metric }, api);
      expect(data.value).toBe(0);
      expect(data.display).toBe("—");
    });
  }
});

describe("intelligence_metric — latency formatting crosses the hour boundary", () => {
  it("a 90-minute median formats as 1h 30m", async () => {
    // Single resolved blocker with a 90-minute latency → median = that value.
    const rows: Record<string, unknown>[] = [
      {
        id: "x1",
        status: "resolved",
        created_at: "2026-05-01T10:00:00.000Z",
        resolved_at: "2026-05-01T11:30:00.000Z", // +90 min
        reason_kind: "k",
        blocked_actor_id: "a",
        summary: "s",
      },
    ];
    const data = await entry.queryBinding({ metric: "decision_latency" }, makeFakeApi(rows));
    expect(data.value).toBe(90 * 60 * 1000);
    expect(data.display).toBe("1h 30m");
  });
});

describe("intelligence_metric — validateWidgetConfig", () => {
  // validateWidgetConfig is ontology-aware; intelligence_metric carries no `type`,
  // so the ontology only gates the shape parse (no membership/field check), but the
  // 3rd arg is now required by the signature.
  let ontology: Ontology;
  beforeAll(async () => {
    ontology = await loadOntology(path.resolve(__dirname, "../../ontology"));
  });

  it("accepts a valid metric name", () => {
    const r = validateWidgetConfig("intelligence_metric", { metric: "scenario_acceptance" }, ontology);
    expect(r.ok).toBe(true);
  });

  it("rejects an invalid metric name", () => {
    const r = validateWidgetConfig("intelligence_metric", { metric: "not_a_metric" }, ontology);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_config");
  });
});
