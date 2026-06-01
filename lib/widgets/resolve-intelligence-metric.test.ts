// Regression: the steward board's KPI widgets (M3 deliverable #6) were generated
// by deriveDefaultBoard but SILENTLY DROPPED by resolveDescriptors — its kind
// gate carried a stale local whitelist ("metric","data_table","roster","calendar")
// that omitted "intelligence_metric", so every KPI descriptor hit `continue`
// before resolving. The descriptor-generation tests (intelligence-metric.test.ts)
// passed while the LIVE board showed no KPIs. This test pins the resolve seam:
// an intelligence_metric descriptor must SURVIVE resolveDescriptors, not vanish.
//
// DB-free: createReadOnlyDataApi is stubbed so api.communityIntelligence() returns
// fixed KPIs; the ontology is the small-community scenario (has agent_blocker).
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import path from "node:path";

const SMALL = path.resolve(__dirname, "..", "..", "scenarios", "small-community", "ontology");

vi.mock("@/lib/widgets/read-api", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/widgets/read-api")>();
  return {
    ...actual,
    createReadOnlyDataApi: () => ({
      communityIntelligence: async () => ({
        autonomyRatio: 0.73,
        scenarioAcceptanceRate: 1,
        decisionLatencyMsMedian: 2_400_000,
        coordinationCoverage: 0.95,
        resolutionAccuracy: 0.94,
      }),
    }),
  };
});

import { resolveDescriptors } from "@/lib/widgets/per-user";

describe("resolveDescriptors — intelligence_metric survives the kind gate", () => {
  const prev = process.env.ACROPOLISOS_ONTOLOGY_DIR;
  beforeAll(() => {
    process.env.ACROPOLISOS_ONTOLOGY_DIR = SMALL;
  });
  afterAll(() => {
    process.env.ACROPOLISOS_ONTOLOGY_DIR = prev;
  });

  it("resolves an intelligence_metric descriptor instead of dropping it", async () => {
    const out = await resolveDescriptors(
      {} as never,
      [{ id: "kpi-autonomy", kind: "intelligence_metric", config: { kpi: "autonomy" } }],
      () => true,
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("intelligence_metric");
    expect((out[0].data as { display?: string }).display).toBe("73%");
  });

  it("resolves all four surfaced KPIs together (autonomy, acceptance, coverage, accuracy)", async () => {
    const descriptors = (["autonomy", "acceptance", "coverage", "accuracy"] as const).map(
      (kpi) => ({ id: `kpi-${kpi}`, kind: "intelligence_metric" as const, config: { kpi } }),
    );
    const out = await resolveDescriptors({} as never, descriptors, () => true);
    expect(out.map((w) => w.kind)).toEqual([
      "intelligence_metric",
      "intelligence_metric",
      "intelligence_metric",
      "intelligence_metric",
    ]);
    expect(out.map((w) => (w.data as { display?: string }).display)).toEqual([
      "73%",
      "100%",
      "95%",
      "94%",
    ]);
  });
});
