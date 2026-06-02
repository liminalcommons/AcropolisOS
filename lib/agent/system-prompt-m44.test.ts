// M4.4: system prompt contract tests.
// Verifies that AGENT_INSTRUCTIONS encodes the M4.4 behavioral contracts:
//   - PROACTIVELY identify human bottlenecks → call flag_blocker
//   - Call query_member_context FIRST on open-ended self-directed questions
//   - Pathways reasoning contract: ≥2 distinct pathways required
// Note: pin_widget_to_member_context instruction removed (Clean Break, negativa-cycle-8 #1).

import { describe, expect, it } from "vitest";
import { AGENT_INSTRUCTIONS } from "./mastra";

describe("AGENT_INSTRUCTIONS — M4.4 system prompt contracts", () => {
  it("contains flag_blocker escalation instruction", () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/flag_blocker/);
  });

  it("references all 5 trigger conditions for blocking (a-e)", () => {
    // The instruction must name the key triggers that warrant flag_blocker.
    expect(AGENT_INSTRUCTIONS).toMatch(/confirmation_required/);
    expect(AGENT_INSTRUCTIONS).toMatch(/ambiguit/i);
    expect(AGENT_INSTRUCTIONS).toMatch(/missing.?data|missing data/i);
    expect(AGENT_INSTRUCTIONS).toMatch(/permission.?gate|permission gate/i);
    expect(AGENT_INSTRUCTIONS).toMatch(/always_confirm/);
  });

  it("instructs agent to call query_member_context FIRST on open-ended questions", () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/query_member_context/);
    expect(AGENT_INSTRUCTIONS).toMatch(/FIRST|first/);
    expect(AGENT_INSTRUCTIONS).toMatch(/what should I do|what is on my plate|help me/i);
  });

  it("enforces pathways reasoning contract (≥2 distinct pathways with rationale + reversibility)", () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/pathways/);
    expect(AGENT_INSTRUCTIONS).toMatch(/at least 2|>= 2/);
    expect(AGENT_INSTRUCTIONS).toMatch(/reversibility/);
    expect(AGENT_INSTRUCTIONS).toMatch(/rationale/);
  });

  it("instructs agent not to silently abandon work", () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/do NOT silently abandon|Do NOT silently abandon/i);
  });

  it("enforces text_input authoring contract (input_schema with a specific prompt)", () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/text_input/);
    expect(AGENT_INSTRUCTIONS).toMatch(/input_schema/);
    expect(AGENT_INSTRUCTIONS).toMatch(/prompt/);
  });

  it("enforces confirm_binary authoring contract (confirm_action with label + reversibility)", () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/confirm_binary/);
    expect(AGENT_INSTRUCTIONS).toMatch(/confirm_action/);
    expect(AGENT_INSTRUCTIONS).toMatch(/label/);
    // reversibility shown so the human sees the stakes before confirming
    expect(AGENT_INSTRUCTIONS).toMatch(/reversibility/);
  });
});
