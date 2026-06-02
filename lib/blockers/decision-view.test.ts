// The pure view-model behind the Focus decision surface: queue ordering +
// per-decision anatomy (framing, safest-first scenarios, learning trace). The
// load-bearing opinion: reversibility ordering is NEVER overridden by
// popularity — the recommended scenario is always the safest, even when the
// community most-often picks a less-reversible one (which the trace still shows).
import { describe, it, expect } from "vitest";
import {
  orderDecisionQueue,
  buildDecisionView,
  buildDiscussPrompt,
  type DecisionInput,
} from "@/lib/blockers/decision-view";

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

describe("buildDecisionView — text_input + confirm_binary anatomy", () => {
  it("text_input: surfaces the input prompt from input_schema (object OR JSON string)", () => {
    const fromObj = buildDecisionView(
      mk({
        resolution_mode: "text_input",
        input_schema: { kind: "string", prompt: "What is the guest's dietary need?" },
      }),
      [],
    );
    expect(fromObj.mode).toBe("text_input");
    expect(fromObj.inputPrompt).toBe("What is the guest's dietary need?");
    expect(fromObj.confirm).toBeNull();

    const fromStr = buildDecisionView(
      mk({ resolution_mode: "text_input", input_schema: JSON.stringify({ prompt: "Phone number?" }) }),
      [],
    );
    expect(fromStr.inputPrompt).toBe("Phone number?");
  });

  it("text_input with no/garbage schema → null prompt (the UI falls back to a generic label)", () => {
    expect(buildDecisionView(mk({ resolution_mode: "text_input", input_schema: null }), []).inputPrompt).toBeNull();
    expect(buildDecisionView(mk({ resolution_mode: "text_input", input_schema: "not json" }), []).inputPrompt).toBeNull();
  });

  it("confirm_binary: surfaces confirm label + reversibility (default moderate, honors permanent)", () => {
    const moderate = buildDecisionView(
      mk({ resolution_mode: "confirm_binary", confirm_action: { label: "Post the rules", action: { type: "x" } } }),
      [],
    );
    expect(moderate.mode).toBe("confirm_binary");
    expect(moderate.confirm).toEqual({ label: "Post the rules", reversibility: "moderate" });
    expect(moderate.inputPrompt).toBeNull();

    const permanent = buildDecisionView(
      mk({
        resolution_mode: "confirm_binary",
        confirm_action: JSON.stringify({ label: "Delete the channel", action: {}, reversibility: "permanent" }),
      }),
      [],
    );
    expect(permanent.confirm).toEqual({ label: "Delete the channel", reversibility: "permanent" });
  });

  it("confirm_binary with no/garbage confirm_action → null confirm", () => {
    expect(buildDecisionView(mk({ resolution_mode: "confirm_binary", confirm_action: null }), []).confirm).toBeNull();
    expect(
      buildDecisionView(mk({ resolution_mode: "confirm_binary", confirm_action: { action: {} } }), []).confirm,
    ).toBeNull(); // missing label
  });

  it("pathways mode leaves inputPrompt + confirm null", () => {
    const v = buildDecisionView(mk({ pathways: PATHS }), []);
    expect(v.inputPrompt).toBeNull();
    expect(v.confirm).toBeNull();
  });
});

describe("buildDiscussPrompt — the 'Discuss with the agent' deep-link seed", () => {
  it("seeds the decision context and asks the agent to advise WITHOUT acting", () => {
    const v = buildDecisionView(mk({ summary: "Overstay on C3-B2", detail: "Booked to May 30.", pathways: PATHS }), []);
    const p = buildDiscussPrompt(v);
    expect(p).toContain("Overstay on C3-B2"); // the summary
    expect(p).toContain("Booked to May 30."); // the detail
    // pathways → lists the options the agent offered
    expect(p).toContain("Extend work-trade");
    expect(p).toContain("Charge overstay fee");
    // and explicitly tells the agent not to act yet (it's a discussion, not a disposition)
    expect(p).toMatch(/don't|do not/i);
    expect(p).toMatch(/recommend/i);
  });

  it("confirm_binary → references the single proposed action", () => {
    const v = buildDecisionView(
      mk({ summary: "Publish house rules", resolution_mode: "confirm_binary", confirm_action: { label: "Post to public board", action: {} } }),
      [],
    );
    expect(buildDiscussPrompt(v)).toContain("Post to public board");
  });

  it("text_input → references the question the agent asked", () => {
    const v = buildDecisionView(
      mk({ summary: "Need dietary info", resolution_mode: "text_input", input_schema: { prompt: "What is the guest's dietary need?" } }),
      [],
    );
    expect(buildDiscussPrompt(v)).toContain("What is the guest's dietary need?");
  });
});
