import { describe, expect, it } from "vitest";
import { mergeApprovedIntoFloor } from "./merge";
import type { SliceDescriptor } from "@/lib/widgets/derive-board";
import type { ApprovedViewDescriptor } from "./registry";

const floor: SliceDescriptor[] = [
  { kind: "data_table", title: "Member", config: { type: "member", columns: ["handle"] } },
];

const approved: ApprovedViewDescriptor[] = [
  { id: "a-1", kind: "metric", title: "Member count", config: { type: "member", agg: "count" } },
];

describe("mergeApprovedIntoFloor", () => {
  it("appends approved descriptors after the derived floor", () => {
    const out = mergeApprovedIntoFloor(floor, approved);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("data_table"); // floor first
    expect(out[1].kind).toBe("metric"); // approved after
    expect((out[1] as { id?: string }).id).toBe("a-1");
  });

  it("an approved descriptor with the same id as a floor entry REPLACES it in place", () => {
    const floorWithId: SliceDescriptor[] = [
      { kind: "data_table", title: "Member", config: { type: "member", columns: ["handle"] } },
    ];
    const overriding: ApprovedViewDescriptor[] = [
      { id: "derived-0", kind: "roster", title: "Roster", config: { type: "member", fields: ["handle"] } },
    ];
    // floor entries get a stable id "derived-<n>" assigned by the merge
    const out = mergeApprovedIntoFloor(floorWithId, overriding);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("roster");
  });

  it("empty approved returns the floor unchanged (with stable ids assigned)", () => {
    const out = mergeApprovedIntoFloor(floor, []);
    expect(out).toHaveLength(1);
    expect((out[0] as { id?: string }).id).toBe("derived-0");
  });
});
