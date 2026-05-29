// lib/ontology/casing.test.ts
import { describe, expect, it } from "vitest";
import { pascalToSnake, snakeToPascal } from "@/lib/ontology/casing";

describe("casing helpers", () => {
  const PAIRS: [string, string][] = [
    ["Guest", "guest"],
    ["Member", "member"],
    ["AgentBlocker", "agent_blocker"],
    ["WorkTradeAgreement", "work_trade_agreement"],
    ["IncidentLog", "incident_log"],
    ["MemberContext", "member_context"],
  ];

  it("pascalToSnake converts every shipped object-type name", () => {
    for (const [pascal, snake] of PAIRS) expect(pascalToSnake(pascal)).toBe(snake);
  });

  it("snakeToPascal is the inverse", () => {
    for (const [pascal, snake] of PAIRS) expect(snakeToPascal(snake)).toBe(pascal);
  });

  it("round-trips pascal → snake → pascal", () => {
    for (const [pascal] of PAIRS) expect(snakeToPascal(pascalToSnake(pascal))).toBe(pascal);
  });
});
