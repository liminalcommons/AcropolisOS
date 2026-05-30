import { describe, expect, it } from "vitest";
import { mergeApprovedIntoFloor } from "@/lib/views/merge";
import { resolveApprovedViews } from "@/lib/views/resolve";
import { InMemoryApprovedViewsRegistry } from "@/lib/views/registry";
import { deriveDefaultBoard } from "@/lib/widgets/derive-board";
import { loadOntology } from "@/lib/ontology/load";
import path from "node:path";

const SMALL = path.resolve(__dirname, "..", "..", "seed", "small-community");

// This test pins the COMPOSITION used by resolvePerUserDashboard's floor branch:
// derived floor → merge approved → run. We assert the composed descriptor list
// (not a DB render) so it is deterministic and DB-free.
describe("per-user floor + approved-views composition", () => {
  it("approved view appends after the derived floor for a permitted viewer", async () => {
    const ontology = await loadOntology(SMALL);
    const canReadType = () => true;
    const floor = deriveDefaultBoard(ontology, canReadType);

    const reg = new InMemoryApprovedViewsRegistry();
    await reg.upsert(
      { scope: "role", scope_key: "steward" },
      [{ id: "extra", kind: "metric", config: { type: "member", agg: "count" }, title: "Members" }],
      "x",
    );
    const approved = await resolveApprovedViews(reg, { id: "m-1", role: "steward" }, canReadType);
    const merged = mergeApprovedIntoFloor(floor, approved);

    expect(merged.length).toBe(floor.length + 1);
    expect(merged.some((d) => d.id === "extra")).toBe(true);
  });
});
