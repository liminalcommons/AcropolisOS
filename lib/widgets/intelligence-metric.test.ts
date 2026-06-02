// Item-1 (M3 deliverable #6): the intelligence_metric widget — KPI → MetricData
// mapping (pure) + its inclusion on the steward admin board (pure). The KPI math
// itself is covered by lib/metrics/community-intelligence.test.ts; here we test
// the widget-layer wiring without a DB.

import { describe, it, expect } from "vitest";
import {
  kpiToMetricData,
  INTELLIGENCE_KPIS,
} from "@/lib/widgets/catalog";
import { deriveDefaultBoard } from "@/lib/widgets/derive-board";
import type { CommunityIntelligenceMetrics } from "@/lib/metrics/community-intelligence";
import type { Ontology } from "@/lib/ontology/schema";
import type { CanReadType } from "@/lib/widgets/read-api";

describe("kpiToMetricData", () => {
  const m: CommunityIntelligenceMetrics = {
    autonomyRatio: 0.69,
    scenarioAcceptanceRate: 1,
    decisionLatencyMsMedian: 1_800_000, // 30 min
    coordinationCoverage: 0.79,
    resolutionAccuracy: 0.93,
  };

  it("renders ratio KPIs as rounded percentages with their labels", () => {
    expect(kpiToMetricData("autonomy", m)).toMatchObject({ display: "69%", label: "Agent autonomy" });
    expect(kpiToMetricData("acceptance", m).display).toBe("100%");
    expect(kpiToMetricData("coverage", m).display).toBe("79%");
    expect(kpiToMetricData("accuracy", m).display).toBe("93%");
  });

  it("renders latency in whole minutes", () => {
    expect(kpiToMetricData("latency", m).display).toBe("30 min");
  });

  it("renders a null KPI as em-dash — never a fake 0", () => {
    const empty: CommunityIntelligenceMetrics = {
      autonomyRatio: null,
      scenarioAcceptanceRate: null,
      decisionLatencyMsMedian: null,
      coordinationCoverage: null,
      resolutionAccuracy: null,
    };
    for (const kpi of INTELLIGENCE_KPIS) {
      expect(kpiToMetricData(kpi, empty).display).toBe("—");
    }
  });
});

describe("deriveDefaultBoard — intelligence_metric on the steward board", () => {
  const ontology = {
    object_types: {
      AgentBlocker: {
        title_property: "summary",
        properties: {
          id: { type: "uuid", primary_key: true },
          status: { type: "string" },
          summary: { type: "string" },
          reason_kind: { type: "string" },
        },
      },
    },
    action_types: {},
    properties: {},
    roles: {},
    link_types: {},
  } as unknown as Ontology;

  const allow: CanReadType = () => true;

  it("includes the four KPI widgets for a steward when agent_blocker is readable AND has history", () => {
    // cold_board: the KPIs are gated on real history — 0% cards on a fresh
    // install are hollow. With history present they appear.
    const board = deriveDefaultBoard(ontology, allow, {
      admin: true,
      hasBlockerHistory: true,
    });
    const kpis = board
      .filter((d) => d.kind === "intelligence_metric")
      .map((d) => (d.config as { kpi: string }).kpi);
    expect(kpis).toEqual(["autonomy", "acceptance", "coverage", "accuracy"]);
  });

  it("omits the KPI widgets on a cold board (agent_blocker readable but no history)", () => {
    const board = deriveDefaultBoard(ontology, allow, {
      admin: true,
      hasBlockerHistory: false,
    });
    expect(board.filter((d) => d.kind === "intelligence_metric")).toHaveLength(0);
  });

  it("omits the KPI widgets when agent_blocker is NOT readable (fail-closed)", () => {
    const deny: CanReadType = () => false;
    const board = deriveDefaultBoard(ontology, deny, {
      admin: true,
      hasBlockerHistory: true,
    });
    expect(board.filter((d) => d.kind === "intelligence_metric")).toHaveLength(0);
  });

  it("omits the KPI widgets in non-admin (member) mode", () => {
    const board = deriveDefaultBoard(ontology, allow, {
      admin: false,
      hasBlockerHistory: true,
    });
    expect(board.filter((d) => d.kind === "intelligence_metric")).toHaveLength(0);
  });
});
