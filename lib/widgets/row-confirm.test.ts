// Per-row BINARY CONFIRM (row_confirm) DERIVATION — proves the THIRD affordance
// shape comes from the ontology shape, not a per-type literal.
//
// The rule: an action is a row confirm FOR object type T iff it declares a
// `row_confirm` mapping AND has exactly TWO required params — one a `ref`
// targeting T (the row id) and the other the `invocation_param` the
// server-derived action JSON binds to. This naturally yields
// `resolve_blocker_with_custom` for AgentBlocker (blocker_id ref +
// action_invocation required) and EXCLUDES single-required-ref one-click actions
// (dismiss_blocker has no row_confirm).

import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { confirmsForType, rowConfirmFor, parseConfirmAction } from "./row-confirm";
import { loadOntology } from "@/lib/ontology/load";
import type { Ontology } from "@/lib/ontology/schema";

let ontology: Ontology;

beforeAll(async () => {
  // Real shipped ontology — same source the dashboard render path loads.
  ontology = await loadOntology(path.resolve(__dirname, "../../ontology"));
});

describe("confirmsForType", () => {
  it("derives exactly the custom-resolve confirm for agent_blocker", () => {
    expect(confirmsForType("agent_blocker", ontology)).toEqual([
      {
        action: "resolve_blocker_with_custom",
        refParam: "blocker_id",
        source: "confirm_action",
        invocationParam: "action_invocation",
      },
    ]);
  });

  it("returns [] for member (no row_confirm action targets Member)", () => {
    expect(confirmsForType("member", ontology)).toEqual([]);
  });

  it("returns [] for room (no row_confirm action targets Room)", () => {
    expect(confirmsForType("room", ontology)).toEqual([]);
  });
});

// rowConfirmFor is the SERVER invocation gate's exact check (used by
// row-action.server.ts's invokeRowConfirm). Testing it directly covers the
// security boundary — not just the render helper — so the two cannot drift.
describe("rowConfirmFor (server invocation gate)", () => {
  it("returns the confirm shape for resolve_blocker_with_custom", () => {
    const c = rowConfirmFor(ontology.action_types.resolve_blocker_with_custom);
    expect(c).toEqual({
      action: "",
      refParam: "blocker_id",
      source: "confirm_action",
      invocationParam: "action_invocation",
    });
  });

  it("returns null for dismiss_blocker (no row_confirm mapping)", () => {
    expect(rowConfirmFor(ontology.action_types.dismiss_blocker)).toBeNull();
  });

  it("returns null for an unknown action", () => {
    expect(rowConfirmFor(undefined)).toBeNull();
  });
});

// parseConfirmAction is the PARSE used by BOTH render and the server invocation
// gate — the equivalent of isChoiceMember for confirm. The live UI only renders
// parsed proposals, so the REJECT paths are never exercised in a browser; these
// tests cover them directly.
describe("parseConfirmAction (the shared {label, action} parse)", () => {
  it("returns {label, action} for a valid proposal", () => {
    const raw = JSON.stringify({
      label: "Extend stay 2 nights",
      action: { type: "extend_booking", params: { nights: 2 } },
    });
    expect(parseConfirmAction(raw)).toEqual({
      label: "Extend stay 2 nights",
      action: { type: "extend_booking", params: { nights: 2 } },
    });
  });

  it("REJECTS corrupt / non-JSON source (fail-closed)", () => {
    expect(parseConfirmAction("{not valid json")).toBeNull();
  });

  it("REJECTS a non-string source (null/undefined/object/number)", () => {
    expect(parseConfirmAction(null)).toBeNull();
    expect(parseConfirmAction(undefined)).toBeNull();
    expect(parseConfirmAction(42)).toBeNull();
    expect(parseConfirmAction({ label: "x", action: {} })).toBeNull();
  });

  it("REJECTS a non-object JSON value (array / scalar)", () => {
    expect(parseConfirmAction("[]")).toBeNull();
    expect(parseConfirmAction('"just a string"')).toBeNull();
  });

  it("REJECTS a missing or non-string label", () => {
    expect(parseConfirmAction(JSON.stringify({ action: { type: "x" } }))).toBeNull();
    expect(
      parseConfirmAction(JSON.stringify({ label: 7, action: { type: "x" } })),
    ).toBeNull();
  });

  it("REJECTS a missing action", () => {
    expect(parseConfirmAction(JSON.stringify({ label: "no action here" }))).toBeNull();
  });
});
