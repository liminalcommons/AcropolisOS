import { describe, expect, it } from "vitest";
import { groupActionsByPolicy } from "./kinetic";
import type { GraphAction } from "./derive";

function act(id: string, policy: GraphAction["policy"]): GraphAction {
  return { id, label: id, policy, permissions: [], sideEffects: [], primaryTarget: null, targets: [] };
}

describe("groupActionsByPolicy (the kinetic layer)", () => {
  it("groups verbs by autonomy in most→least-autonomous order, sorted within a group", () => {
    const groups = groupActionsByPolicy([
      act("log_incident", "auto_apply"),
      act("check_in", "always_confirm"),
      act("approve_member", "always_confirm"),
      act("claim_shift", "confirm_if_unfamiliar"),
    ]);
    expect(groups.map((g) => g.policy)).toEqual(["auto_apply", "confirm_if_unfamiliar", "always_confirm"]);
    expect(groups[0].actions.map((a) => a.id)).toEqual(["log_incident"]);
    expect(groups[2].actions.map((a) => a.id)).toEqual(["approve_member", "check_in"]); // sorted
  });

  it("drops empty policy groups", () => {
    const groups = groupActionsByPolicy([act("a", "auto_apply")]);
    expect(groups.map((g) => g.policy)).toEqual(["auto_apply"]);
  });

  it("no actions -> no groups", () => {
    expect(groupActionsByPolicy([])).toEqual([]);
  });
});
