import { describe, expect, it } from "vitest";
import { ViewConfigProposal } from "./view-proposal";

describe("ViewConfigProposal", () => {
  it("accepts a scope + descriptor list (config, NOT tsx)", () => {
    const r = ViewConfigProposal.safeParse({
      scope: "role",
      scope_key: "steward",
      descriptors: [
        { id: "v1", kind: "metric", config: { type: "member", agg: "count" }, title: "Members" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a tsx_body payload (the old hand-coded shape is gone)", () => {
    const r = ViewConfigProposal.safeParse({
      object_type: "Member",
      view: "detail",
      tsx_body: "<div/>",
    });
    expect(r.success).toBe(false);
  });

  it("rejects org scope with a non-empty scope_key", () => {
    const r = ViewConfigProposal.safeParse({
      scope: "org",
      scope_key: "steward",
      descriptors: [],
    });
    expect(r.success).toBe(false);
  });

  // C1: the `derived-<index>` id namespace is RESERVED for floor slots in
  // merge.ts (mergeApprovedIntoFloor maps floor[i] → id `derived-${i}`). An
  // author-supplied `derived-N` would silently clobber that floor slot by id.
  // The schema must reject it so a proposal can only REPLACE a floor slot
  // deliberately, never by accidental id collision.
  it("rejects a descriptor id in the reserved derived-N floor namespace", () => {
    const r = ViewConfigProposal.safeParse({
      scope: "role",
      scope_key: "steward",
      descriptors: [
        { id: "derived-1", kind: "metric", config: { type: "member" } },
      ],
    });
    expect(r.success).toBe(false);
  });
});
