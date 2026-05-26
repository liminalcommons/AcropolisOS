// Per-row CHOICE-picker (row_resolver) DERIVATION — proves the affordance comes
// from the ontology shape, not a per-type literal.
//
// The rule: an action is a row resolver FOR object type T iff it declares a
// `row_resolver` mapping AND has exactly TWO required params — one a `ref`
// targeting T (the row id) and the other the `choice_param` the chosen option
// binds to. This naturally yields `resolve_blocker_with_pathway` for
// AgentBlocker (blocker_id ref + pathway_id required) and EXCLUDES the
// single-required-ref one-click actions (dismiss_blocker has no row_resolver).

import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { resolversForType, rowResolverFor, isChoiceMember } from "./row-resolver";
import { loadOntology } from "@/lib/ontology/load";
import type { Ontology } from "@/lib/ontology/schema";

let ontology: Ontology;

beforeAll(async () => {
  // Real shipped ontology — same source the dashboard render path loads.
  ontology = await loadOntology(path.resolve(__dirname, "../../ontology"));
});

describe("resolversForType", () => {
  it("derives exactly the pathway resolver for agent_blocker", () => {
    expect(resolversForType("agent_blocker", ontology)).toEqual([
      {
        action: "resolve_blocker_with_pathway",
        refParam: "blocker_id",
        choicesFrom: "pathways",
        choiceParam: "pathway_id",
      },
    ]);
  });

  it("returns [] for member (no row_resolver action targets Member)", () => {
    expect(resolversForType("member", ontology)).toEqual([]);
  });

  it("returns [] for room (no row_resolver action targets Room)", () => {
    expect(resolversForType("room", ontology)).toEqual([]);
  });
});

// rowResolverFor is the SERVER invocation gate's exact check (used by
// row-action.server.ts's invokeRowResolver). Testing it directly covers the
// security boundary — not just the render helper — so the two cannot drift.
describe("rowResolverFor (server invocation gate)", () => {
  it("returns the resolver shape for resolve_blocker_with_pathway", () => {
    const r = rowResolverFor(ontology.action_types.resolve_blocker_with_pathway);
    expect(r).toEqual({
      action: "",
      refParam: "blocker_id",
      choicesFrom: "pathways",
      choiceParam: "pathway_id",
    });
  });

  it("returns null for dismiss_blocker (no row_resolver mapping)", () => {
    expect(rowResolverFor(ontology.action_types.dismiss_blocker)).toBeNull();
  });

  it("returns null for an unknown action", () => {
    expect(rowResolverFor(undefined)).toBeNull();
  });
});

// isChoiceMember is the MEMBERSHIP control behind invokeRowResolver — it stops an
// arbitrary choiceId from reaching the always_confirm action. The live UI only
// renders valid choices, so the REJECT paths are never exercised in a browser;
// these tests cover them directly.
describe("isChoiceMember (membership security control)", () => {
  const choices = JSON.stringify([
    { id: "11111111-1111-4111-8111-111111111111", label: "Extend stay" },
    { id: "22222222-2222-4222-8222-222222222222", label: "Charge fee" },
  ]);

  it("ACCEPTS an id that is one of the curated choices", () => {
    expect(isChoiceMember(choices, "22222222-2222-4222-8222-222222222222")).toBe(true);
  });

  it("REJECTS an arbitrary id not in the choices (the core attack)", () => {
    expect(isChoiceMember(choices, "99999999-9999-4999-8999-999999999999")).toBe(false);
  });

  it("REJECTS corrupt / non-JSON choices (fail-closed)", () => {
    expect(isChoiceMember("{not valid json", "11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("REJECTS a non-array JSON value (fail-closed)", () => {
    expect(isChoiceMember('{"id":"11111111-1111-4111-8111-111111111111"}', "11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("REJECTS when choices is not a string (null/undefined/object)", () => {
    expect(isChoiceMember(null, "x")).toBe(false);
    expect(isChoiceMember(undefined, "x")).toBe(false);
    expect(isChoiceMember(42, "x")).toBe(false);
  });

  it("REJECTS an element with no matching id, and an empty array", () => {
    expect(isChoiceMember('[{"label":"no id here"}]', "x")).toBe(false);
    expect(isChoiceMember("[]", "x")).toBe(false);
  });
});
