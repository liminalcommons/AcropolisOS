// lib/widgets/arrange.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { moveItem, removeItem, addItem, toSelections, addableWidgets, type ArrangeItem } from "./arrange";
import { loadOntology } from "@/lib/ontology/load";

const items: ArrangeItem[] = [
  { id: "a", kind: "metric", config: { type: "guest", agg: "count" } },
  { id: "b", kind: "roster", config: { type: "shift", fields: ["label"], limit: 10 } },
  { id: "c", kind: "data_table", config: { type: "guest", columns: ["full_name"], limit: 15 } },
];

describe("moveItem", () => {
  it("moves up", () => {
    expect(moveItem(items, "b", "up").map((i) => i.id)).toEqual(["b", "a", "c"]);
  });
  it("moves down", () => {
    expect(moveItem(items, "b", "down").map((i) => i.id)).toEqual(["a", "c", "b"]);
  });
  it("no-op at top edge moving up", () => {
    expect(moveItem(items, "a", "up").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("no-op at bottom edge moving down", () => {
    expect(moveItem(items, "c", "down").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("unknown id is a no-op", () => {
    expect(moveItem(items, "zzz", "up")).toEqual(items);
  });
});

describe("removeItem", () => {
  it("removes by id", () => {
    expect(removeItem(items, "b").map((i) => i.id)).toEqual(["a", "c"]);
  });
  it("unknown id is a no-op", () => {
    expect(removeItem(items, "zzz")).toEqual(items);
  });
});

describe("addItem", () => {
  it("appends a selection with a fresh id", () => {
    const next = addItem(items, { kind: "metric", config: { type: "member", agg: "count" } });
    expect(next).toHaveLength(4);
    expect(next[3].kind).toBe("metric");
    expect(next[3].id).toBeTruthy();
  });
});

describe("toSelections", () => {
  it("strips ids", () => {
    expect(toSelections(items)).toEqual(items.map(({ kind, config }) => ({ kind, config })));
  });
});

describe("addableWidgets", () => {
  it("derives addable selections from the ontology, permission-scoped", async () => {
    const onto = await loadOntology(path.resolve(__dirname, "../../ontology"));
    const all = addableWidgets(onto, () => true);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => typeof s.kind === "string")).toBe(true);
    // permission lens: a viewer who can only read `guest` gets only guest widgets
    const guestOnly = addableWidgets(onto, (t) => t === "guest");
    const types = guestOnly.map((s) => (s.config as { type?: string }).type);
    expect(types).toContain("guest");
    expect(types).not.toContain("member");
    // reading nothing → empty (the floor)
    expect(addableWidgets(onto, () => false)).toEqual([]);
  });
});
