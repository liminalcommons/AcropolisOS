import { describe, expect, it } from "vitest";
import { ProposalDiff, emptyDraft, recomputeImpactedTables } from "./diff";

describe("ProposalDiff schema", () => {
  it("accepts an empty draft", () => {
    const parsed = ProposalDiff.safeParse(emptyDraft());
    expect(parsed.success).toBe(true);
  });

  it("rejects a draft missing required keys", () => {
    const parsed = ProposalDiff.safeParse({ new_object_types: {} });
    expect(parsed.success).toBe(false);
  });

  it("emptyDraft seeds every key", () => {
    const draft = emptyDraft();
    expect(draft.new_object_types).toEqual({});
    expect(draft.new_link_types).toEqual({});
    expect(draft.new_shared_properties).toEqual({});
    expect(draft.modified_properties).toEqual({});
    expect(draft.impacted_tables).toEqual([]);
  });

  it("emptyDraft returns a fresh object each call", () => {
    const a = emptyDraft();
    const b = emptyDraft();
    a.new_object_types["X"] = {
      properties: { id: { type: "uuid", primary_key: true } },
    };
    expect(b.new_object_types).toEqual({});
  });
});

describe("recomputeImpactedTables", () => {
  it("returns new object type names sorted alphabetically", () => {
    const draft = emptyDraft();
    draft.new_object_types["Zone"] = {
      properties: { id: { type: "uuid", primary_key: true } },
    };
    draft.new_object_types["Asset"] = {
      properties: { id: { type: "uuid", primary_key: true } },
    };
    expect(recomputeImpactedTables(draft)).toEqual(["Asset", "Zone"]);
  });

  it("returns empty array when no object types are proposed", () => {
    expect(recomputeImpactedTables(emptyDraft())).toEqual([]);
  });
});
