// The pure view-model behind the Focus decision surface: queue ordering +
// per-decision anatomy (framing, safest-first scenarios, learning trace). The
// load-bearing opinion: reversibility ordering is NEVER overridden by
// popularity — the recommended scenario is always the safest, even when the
// community most-often picks a less-reversible one (which the trace still shows).
import { describe, it, expect } from "vitest";
import { orderDecisionQueue, buildDecisionView, type DecisionInput } from "@/lib/blockers/decision-view";

const mk = (over: Partial<DecisionInput>): DecisionInput => ({
  id: "b1",
  summary: "s",
  detail: "d",
  reason_kind: "decision",
  status: "open",
  created_at: "2026-06-01T00:00:00.000Z",
  blocked_actor_id: null,
  resolution_mode: "pathways",
  pathways: null,
  resolved_via_pathway_id: null,
  ...over,
});

const PATHS = [
  { id: "p-charge", label: "Charge overstay fee", rationale: "€40 to the guest card", reversibility: "permanent" },
  { id: "p-extend", label: "Extend work-trade", rationale: "keeps the guest; bumps the booking", reversibility: "easy" },
  { id: "p-reassign", label: "Reassign bed", rationale: "move guest to D2-C1", reversibility: "moderate" },
];

describe("orderDecisionQueue", () => {
  it("orders oldest-first (SLA), stable", () => {
    const out = orderDecisionQueue([
      mk({ id: "new", created_at: "2026-06-03T00:00:00.000Z" }),
      mk({ id: "old", created_at: "2026-06-01T00:00:00.000Z" }),
      mk({ id: "mid", created_at: "2026-06-02T00:00:00.000Z" }),
    ]);
    expect(out.map((b) => b.id)).toEqual(["old", "mid", "new"]);
  });
});

describe("buildDecisionView", () => {
  it("ranks scenarios safest-first; recommended = the safest", () => {
    const v = buildDecisionView(mk({ pathways: PATHS }), []);
    expect(v.scenarios.map((s) => s.id)).toEqual(["p-extend", "p-reassign", "p-charge"]); // easy < moderate < permanent
    expect(v.scenarios[0]).toMatchObject({ id: "p-extend", recommended: true, reversibility: "easy", consequence: "keeps the guest; bumps the booking" });
    expect(v.scenarios.filter((s) => s.recommended)).toHaveLength(1);
  });

  it("NEVER lets popularity surface a less-reversible option above a safer one", () => {
    // Community resolved 3 prior decisions all via "Charge overstay fee" (permanent).
    const resolved = [1, 2, 3].map((n) =>
      mk({ id: `r${n}`, status: "resolved", resolved_via_pathway_id: "p-charge", pathways: PATHS }),
    );
    const v = buildDecisionView(mk({ pathways: PATHS }), resolved);
    // Charge is most-preferred BUT permanent → still ranked LAST, never recommended.
    expect(v.scenarios[0].id).toBe("p-extend");
    expect(v.scenarios.find((s) => s.id === "p-charge")!.recommended).toBe(false);
    // ...yet the trace honestly surfaces what the community actually picks.
    expect(v.trace).toMatchObject({ label: "Charge overstay fee", count: 3, total: 3 });
  });

  it("carries framing, mode, and reversibility default (moderate when unset)", () => {
    const v = buildDecisionView(
      mk({ summary: "Overstay on C3-B2", reason_kind: "risky_action", pathways: [{ id: "x", label: "Do it" }] }),
      [],
    );
    expect(v).toMatchObject({ summary: "Overstay on C3-B2", reasonKind: "risky_action", mode: "pathways" });
    expect(v.scenarios[0].reversibility).toBe("moderate"); // unset → neutral default
  });

  it("passes through non-pathways modes with no scenarios", () => {
    const t = buildDecisionView(mk({ resolution_mode: "text_input", pathways: null }), []);
    expect(t.mode).toBe("text_input");
    expect(t.scenarios).toHaveLength(0);
    expect(t.trace).toBeNull();
    const c = buildDecisionView(mk({ resolution_mode: "confirm_binary", pathways: null }), []);
    expect(c.mode).toBe("confirm_binary");
  });

  it("defaults to pathways mode and tolerates empty/garbage pathways", () => {
    expect(buildDecisionView(mk({ resolution_mode: null, pathways: "not json" }), []).mode).toBe("pathways");
    expect(buildDecisionView(mk({ pathways: [] }), []).scenarios).toHaveLength(0);
  });
});
