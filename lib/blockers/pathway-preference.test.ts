// Pure unit tests for pathway-preference helpers.
// No DB, no ontology, no @/ alias — relative import only.

import { describe, it, expect } from "vitest";
import {
  parsePathways,
  pathwayIdentity,
  computePathwayPreference,
  rankPathways,
  type Pathway,
  type BlockerRow,
} from "./pathway-preference";

// ---------------------------------------------------------------------------
// parsePathways
// ---------------------------------------------------------------------------

describe("parsePathways", () => {
  const validArray: Pathway[] = [
    { id: "aaa", label: "Option A", action: { type: "approve" } },
    { id: "bbb", label: "Option B" },
  ];

  it("parses a valid JSON string into an array", () => {
    const result = parsePathways(JSON.stringify(validArray));
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("aaa");
    expect(result[1].id).toBe("bbb");
  });

  it("returns an already-parsed array as-is (filtering valid objects)", () => {
    const result = parsePathways(validArray);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Option A");
  });

  it("returns [] for null", () => {
    expect(parsePathways(null)).toEqual([]);
  });

  it("returns [] for undefined", () => {
    expect(parsePathways(undefined)).toEqual([]);
  });

  it("returns [] for a non-array JSON string (object)", () => {
    expect(parsePathways('{"id":"x"}')).toEqual([]);
  });

  it("returns [] for a string that is not valid JSON", () => {
    expect(parsePathways("not json at all")).toEqual([]);
  });

  it("returns [] for a number", () => {
    expect(parsePathways(42)).toEqual([]);
  });

  it("filters out array elements missing a string id", () => {
    const mixed = [
      { id: "valid", label: "Good" },
      { label: "No id" },
      { id: 123, label: "Numeric id" },
      null,
    ];
    const result = parsePathways(mixed);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("valid");
  });

  it("returns [] for an array of primitives", () => {
    expect(parsePathways(["a", "b", "c"])).toEqual([]);
  });

  it("returns [] for an empty string", () => {
    expect(parsePathways("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pathwayIdentity
// ---------------------------------------------------------------------------

describe("pathwayIdentity", () => {
  it("returns action.type when it is a non-empty string", () => {
    const p: Pathway = { id: "x", label: "Approve request", action: { type: "approve" } };
    expect(pathwayIdentity(p)).toBe("approve");
  });

  it("falls back to label when action.type is absent", () => {
    const p: Pathway = { id: "x", label: "Escalate to steward" };
    expect(pathwayIdentity(p)).toBe("Escalate to steward");
  });

  it("falls back to label when action is undefined", () => {
    const p: Pathway = { id: "x", label: "Do nothing" };
    expect(pathwayIdentity(p)).toBe("Do nothing");
  });

  it("falls back to label when action.type is an empty string", () => {
    const p: Pathway = { id: "x", label: "Fallback label", action: { type: "" } };
    expect(pathwayIdentity(p)).toBe("Fallback label");
  });

  it("falls back to label when action.type is not a string", () => {
    const p: Pathway = {
      id: "x",
      label: "Fallback label",
      action: { type: undefined },
    };
    expect(pathwayIdentity(p)).toBe("Fallback label");
  });
});

// ---------------------------------------------------------------------------
// computePathwayPreference
// ---------------------------------------------------------------------------

describe("computePathwayPreference", () => {
  const pathwayA: Pathway = { id: "pa1", label: "Approve", action: { type: "approve" } };
  const pathwayB: Pathway = { id: "pb1", label: "Defer", action: { type: "defer" } };
  const pathwayC: Pathway = { id: "pc1", label: "Escalate" }; // no action.type

  function resolvedRow(
    reasonKind: string,
    resolvedVia: string,
    pathways: Pathway[],
  ): BlockerRow {
    return {
      reason_kind: reasonKind,
      status: "resolved",
      pathways: JSON.stringify(pathways),
      resolved_via_pathway_id: resolvedVia,
    };
  }

  it("returns an empty map when there are no rows", () => {
    const result = computePathwayPreference([], "decision");
    expect(result.size).toBe(0);
  });

  it("ignores non-resolved rows (open, dismissed, expired)", () => {
    const rows: BlockerRow[] = [
      { reason_kind: "decision", status: "open", pathways: JSON.stringify([pathwayA]), resolved_via_pathway_id: pathwayA.id },
      { reason_kind: "decision", status: "dismissed", pathways: JSON.stringify([pathwayA]), resolved_via_pathway_id: pathwayA.id },
      { reason_kind: "decision", status: "expired", pathways: JSON.stringify([pathwayA]), resolved_via_pathway_id: pathwayA.id },
    ];
    const result = computePathwayPreference(rows, "decision");
    expect(result.size).toBe(0);
  });

  it("ignores rows with a different reason_kind", () => {
    const rows: BlockerRow[] = [
      resolvedRow("approval", pathwayA.id, [pathwayA]),
      resolvedRow("decision", pathwayA.id, [pathwayA]),
    ];
    const result = computePathwayPreference(rows, "confirmation");
    expect(result.size).toBe(0);
  });

  it("ignores rows where resolved_via_pathway_id is null or missing", () => {
    const rows: BlockerRow[] = [
      { reason_kind: "decision", status: "resolved", pathways: JSON.stringify([pathwayA]), resolved_via_pathway_id: null },
      { reason_kind: "decision", status: "resolved", pathways: JSON.stringify([pathwayA]) },
    ];
    const result = computePathwayPreference(rows, "decision");
    expect(result.size).toBe(0);
  });

  it("ignores rows where resolved_via_pathway_id doesn't match any pathway", () => {
    const rows: BlockerRow[] = [
      resolvedRow("decision", "no-such-id", [pathwayA, pathwayB]),
    ];
    const result = computePathwayPreference(rows, "decision");
    expect(result.size).toBe(0);
  });

  it("tallies a single resolved row correctly", () => {
    const rows: BlockerRow[] = [
      resolvedRow("decision", pathwayA.id, [pathwayA, pathwayB]),
    ];
    const result = computePathwayPreference(rows, "decision");
    expect(result.get("approve")).toBe(1);
    expect(result.get("defer")).toBeUndefined();
  });

  it("accumulates counts across multiple rows for the same identity", () => {
    const rows: BlockerRow[] = [
      resolvedRow("decision", pathwayA.id, [pathwayA, pathwayB]),
      resolvedRow("decision", pathwayA.id, [pathwayA, pathwayB]),
      resolvedRow("decision", pathwayB.id, [pathwayA, pathwayB]),
    ];
    const result = computePathwayPreference(rows, "decision");
    expect(result.get("approve")).toBe(2);
    expect(result.get("defer")).toBe(1);
  });

  it("uses pathway.label as identity when action.type is absent", () => {
    const rows: BlockerRow[] = [
      resolvedRow("decision", pathwayC.id, [pathwayC]),
      resolvedRow("decision", pathwayC.id, [pathwayC]),
    ];
    const result = computePathwayPreference(rows, "decision");
    expect(result.get("Escalate")).toBe(2);
  });

  it("handles pathways already parsed (not JSON string) in the row", () => {
    const rows: BlockerRow[] = [
      {
        reason_kind: "decision",
        status: "resolved",
        pathways: [pathwayA, pathwayB], // already an array (jsonb auto-parse)
        resolved_via_pathway_id: pathwayB.id,
      },
    ];
    const result = computePathwayPreference(rows, "decision");
    expect(result.get("defer")).toBe(1);
  });

  it("mixes reason_kinds and only counts the requested one", () => {
    const rows: BlockerRow[] = [
      resolvedRow("decision", pathwayA.id, [pathwayA]),
      resolvedRow("approval", pathwayA.id, [pathwayA]),
      resolvedRow("decision", pathwayA.id, [pathwayA]),
    ];
    const result = computePathwayPreference(rows, "decision");
    expect(result.get("approve")).toBe(2);
    const approvalResult = computePathwayPreference(rows, "approval");
    expect(approvalResult.get("approve")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// rankPathways
// ---------------------------------------------------------------------------

describe("rankPathways", () => {
  const pA: Pathway = { id: "a", label: "A", action: { type: "approve" } };
  const pB: Pathway = { id: "b", label: "B", action: { type: "defer" } };
  const pC: Pathway = { id: "c", label: "C", action: { type: "escalate" } };

  it("returns a new array (does not mutate input)", () => {
    const input = [pA, pB, pC];
    const pref = new Map([["approve", 5]]);
    const result = rankPathways(input, pref);
    expect(result).not.toBe(input);
    expect(input[0]).toBe(pA); // original order preserved in input
  });

  it("is a no-op when preference map is empty (original order preserved)", () => {
    const input = [pA, pB, pC];
    const result = rankPathways(input, new Map());
    expect(result.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("puts the highest-preference pathway first", () => {
    const input = [pA, pB, pC];
    const pref = new Map([
      ["approve", 1],
      ["defer", 5],
      ["escalate", 2],
    ]);
    const result = rankPathways(input, pref);
    expect(result[0].id).toBe("b"); // defer=5 is highest
    expect(result[1].id).toBe("c"); // escalate=2
    expect(result[2].id).toBe("a"); // approve=1
  });

  it("treats unknown identities as count 0", () => {
    const input = [pA, pB, pC];
    const pref = new Map([["approve", 3]]); // only pA has preference
    const result = rankPathways(input, pref);
    expect(result[0].id).toBe("a"); // approve=3 first
    // pB and pC both have count 0 — original relative order preserved (stable)
    expect(result[1].id).toBe("b");
    expect(result[2].id).toBe("c");
  });

  it("preserves original relative order for ties (stable sort)", () => {
    // All three have count 0 → must come back in original order.
    const input = [pC, pA, pB];
    const result = rankPathways(input, new Map());
    expect(result.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });

  it("handles an empty input array", () => {
    expect(rankPathways([], new Map([["approve", 3]]))).toEqual([]);
  });

  it("handles a single-element array", () => {
    const result = rankPathways([pA], new Map([["approve", 10]]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// rankPathways — reversibility safety tier (popularity must NOT lift a
// less-reversible action above a more-reversible one)
// ---------------------------------------------------------------------------

describe("rankPathways — reversibility safety tier", () => {
  it("keeps an easy (reversible) pathway ABOVE a popular permanent one", () => {
    // The falsifiable case: a heavily-chosen irreversible action must NOT
    // be surfaced before a safe reversible one.
    const easyUnpopular: Pathway = {
      id: "e",
      label: "Reschedule (reversible)",
      action: { type: "reschedule" },
      reversibility: "easy",
    };
    const permanentPopular: Pathway = {
      id: "p",
      label: "Delete booking (permanent)",
      action: { type: "delete_booking" },
      reversibility: "permanent",
    };
    const pref = new Map([["delete_booking", 5]]); // permanent is popular
    const result = rankPathways([easyUnpopular, permanentPopular], pref);
    expect(result[0].id).toBe("e"); // safe-first wins over popularity
    expect(result[1].id).toBe("p");
  });

  it("orders easy < moderate < permanent regardless of preference", () => {
    const easy: Pathway = { id: "e", label: "E", action: { type: "e" }, reversibility: "easy" };
    const moderate: Pathway = { id: "m", label: "M", action: { type: "m" }, reversibility: "moderate" };
    const permanent: Pathway = { id: "p", label: "P", action: { type: "p" }, reversibility: "permanent" };
    // Preference favors the most-permanent — must not override the tier order.
    const pref = new Map([["p", 9], ["m", 3]]);
    const result = rankPathways([permanent, moderate, easy], pref);
    expect(result.map((x) => x.id)).toEqual(["e", "m", "p"]);
  });

  it("applies preference as a secondary sort WITHIN the same reversibility tier", () => {
    const a: Pathway = { id: "a", label: "A", action: { type: "a" }, reversibility: "easy" };
    const b: Pathway = { id: "b", label: "B", action: { type: "b" }, reversibility: "easy" };
    const c: Pathway = { id: "c", label: "C", action: { type: "c" }, reversibility: "easy" };
    const pref = new Map([["b", 5], ["c", 2]]);
    const result = rankPathways([a, b, c], pref);
    expect(result.map((x) => x.id)).toEqual(["b", "c", "a"]); // all easy → popularity decides
  });

  it("treats unknown/missing reversibility as the moderate tier (between easy and permanent)", () => {
    const easy: Pathway = { id: "e", label: "E", action: { type: "e" }, reversibility: "easy" };
    const unknown: Pathway = { id: "u", label: "U", action: { type: "u" } }; // no reversibility
    const permanent: Pathway = { id: "p", label: "P", action: { type: "p" }, reversibility: "permanent" };
    const result = rankPathways([permanent, unknown, easy], new Map());
    expect(result.map((x) => x.id)).toEqual(["e", "u", "p"]);
  });
});
