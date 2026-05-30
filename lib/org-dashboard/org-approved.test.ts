import { describe, expect, it } from "vitest";
import { mergeApprovedIntoFloor } from "@/lib/views/merge";
import { resolveApprovedViews } from "@/lib/views/resolve";
import { InMemoryApprovedViewsRegistry } from "@/lib/views/registry";
import { adminDefaultBoard } from "@/lib/org-dashboard/store";
import { loadOntology } from "@/lib/ontology/load";
import path from "node:path";

const SMALL = path.resolve(__dirname, "..", "..", "scenarios", "small-community", "ontology");

describe("org floor + approved org views", () => {
  it("an org-scope approved view appends after the admin floor", async () => {
    const ontology = await loadOntology(SMALL);
    const canReadType = () => true;
    const floor = adminDefaultBoard(ontology, canReadType);

    const reg = new InMemoryApprovedViewsRegistry();
    await reg.upsert(
      { scope: "org", scope_key: "" },
      [{ id: "org-extra", kind: "metric", config: { type: "event", agg: "count" } }],
      "steward@x",
    );
    const approved = await resolveApprovedViews(reg, { id: "steward", role: "steward" }, canReadType);
    const merged = mergeApprovedIntoFloor(floor, approved);

    expect(merged.some((d) => d.id === "org-extra")).toBe(true);
    expect(merged.length).toBe(floor.length + 1);
  });
});
