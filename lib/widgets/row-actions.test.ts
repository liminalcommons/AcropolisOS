// One-click row-action DERIVATION — proves the affordance comes from the
// ontology shape, not a per-type literal.
//
// The rule: an action is a one-click row action FOR object type T iff it has
// exactly ONE required parameter and that parameter is a `ref` whose target is
// T (every other parameter optional). This naturally yields `dismiss_blocker`
// for AgentBlocker (blocker_id required ref + reason optional) and EXCLUDES the
// resolve_blocker_with_* actions (each needs a SECOND required parameter).

import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { oneClickRowActionsForType } from "./row-actions";
import { loadOntology } from "@/lib/ontology/load";
import type { Ontology } from "@/lib/ontology/schema";

let ontology: Ontology;

beforeAll(async () => {
  // Real shipped ontology — same source the dashboard render path loads.
  ontology = await loadOntology(path.resolve(__dirname, "../../ontology"));
});

describe("oneClickRowActionsForType", () => {
  it("derives exactly dismiss_blocker for agent_blocker", () => {
    expect(oneClickRowActionsForType("agent_blocker", ontology)).toEqual([
      { action: "dismiss_blocker", refParam: "blocker_id" },
    ]);
  });

  it("excludes resolve_blocker_with_* (they have a second required param)", () => {
    const actions = oneClickRowActionsForType("agent_blocker", ontology).map(
      (a) => a.action,
    );
    expect(actions).not.toContain("resolve_blocker_with_pathway");
    expect(actions).not.toContain("resolve_blocker_with_input");
    expect(actions).not.toContain("resolve_blocker_with_custom");
  });

  it("returns [] for a type with no qualifying one-click action (room)", () => {
    // Room has no action whose single required ref param targets Room.
    expect(oneClickRowActionsForType("room", ontology)).toEqual([]);
  });
});
