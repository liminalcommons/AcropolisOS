import { describe, expect, it } from "vitest";
import {
  ProposalDiff,
  emptyDraft,
  normalizeDraft,
  recomputeImpactedTables,
} from "./diff";

describe("ProposalDiff.evidence", () => {
  it("emptyDraft carries an empty evidence map", () => {
    expect(emptyDraft().evidence).toEqual({});
  });
  it("parses a diff WITHOUT evidence (back-compat → defaults to {})", () => {
    const { evidence: _e, ...noEvidence } = emptyDraft();
    expect(ProposalDiff.parse(noEvidence).evidence).toEqual({});
  });
  it("round-trips evidence keyed by Type.field", () => {
    const d = { ...emptyDraft(), evidence: { "Guest.passport": ["raw_inbox:abc"] } };
    expect(ProposalDiff.parse(d).evidence["Guest.passport"]).toEqual(["raw_inbox:abc"]);
  });
});

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
    expect(draft.new_action_types).toEqual({});
    expect(draft.new_functions).toEqual({});
    expect(draft.new_view_configs).toEqual({});
    expect(draft.new_seeds).toEqual({});
    expect(draft.new_ingests).toEqual({});
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

  it("unions seed, ingest, and action-type creates_object targets, deduped", () => {
    const draft = emptyDraft();
    draft.new_object_types["A"] = {
      properties: { id: { type: "uuid", primary_key: true } },
    };
    draft.new_seeds["B"] = { object_type: "B", rows_jsonl: "" };
    draft.new_ingests["x"] = {
      inbox_ids: ["1"],
      target_object_type: "C",
      mapping: {},
    };
    draft.new_action_types["mk_a"] = {
      creates_object: "A",
      agent_policy: "always_confirm",
    };
    expect(recomputeImpactedTables(draft)).toEqual(["A", "B", "C"]);
  });
});

describe("normalizeDraft (inline → ref auto-resolve)", () => {
  it("rewrites inline property to ref when a shared property with same name + matching type exists in new_shared_properties", () => {
    const draft = emptyDraft();
    draft.new_shared_properties["pronouns"] = {
      type: "string",
      required: false,
    };
    draft.new_object_types["Member"] = {
      properties: {
        id: { type: "uuid", primary_key: true },
        pronouns: { type: "string" },
      },
    };
    const normalized = normalizeDraft(draft);
    expect(
      normalized.new_object_types["Member"].properties["pronouns"],
    ).toEqual({ ref: "pronouns" });
  });

  it("also resolves against modified_properties", () => {
    const draft = emptyDraft();
    draft.modified_properties["email"] = { type: "email" };
    draft.new_object_types["Member"] = {
      properties: {
        id: { type: "uuid", primary_key: true },
        email: { type: "email" },
      },
    };
    expect(
      normalizeDraft(draft).new_object_types["Member"].properties["email"],
    ).toEqual({ ref: "email" });
  });

  it("preserves required/description overrides from the inline body", () => {
    const draft = emptyDraft();
    draft.new_shared_properties["tag"] = { type: "string" };
    draft.new_object_types["Post"] = {
      properties: {
        id: { type: "uuid", primary_key: true },
        tag: {
          type: "string",
          required: true,
          description: "post-specific tag override",
        },
      },
    };
    expect(
      normalizeDraft(draft).new_object_types["Post"].properties["tag"],
    ).toEqual({
      ref: "tag",
      required: true,
      description: "post-specific tag override",
    });
  });

  it("does NOT rewrite when the inline type does not match the shared property's type", () => {
    const draft = emptyDraft();
    draft.new_shared_properties["count"] = { type: "integer" };
    draft.new_object_types["Bucket"] = {
      properties: {
        id: { type: "uuid", primary_key: true },
        count: { type: "string" },
      },
    };
    expect(
      normalizeDraft(draft).new_object_types["Bucket"].properties["count"],
    ).toEqual({ type: "string" });
  });

  it("is idempotent and leaves ref properties untouched", () => {
    const draft = emptyDraft();
    draft.new_shared_properties["pronouns"] = { type: "string" };
    draft.new_object_types["Member"] = {
      properties: {
        id: { type: "uuid", primary_key: true },
        pronouns: { ref: "pronouns", required: false },
      },
    };
    const once = normalizeDraft(draft);
    const twice = normalizeDraft(once);
    expect(once.new_object_types["Member"].properties["pronouns"]).toEqual({
      ref: "pronouns",
      required: false,
    });
    expect(twice).toEqual(once);
  });

  it("does not mutate the input draft", () => {
    const draft = emptyDraft();
    draft.new_shared_properties["pronouns"] = { type: "string" };
    draft.new_object_types["Member"] = {
      properties: {
        id: { type: "uuid", primary_key: true },
        pronouns: { type: "string" },
      },
    };
    normalizeDraft(draft);
    expect(draft.new_object_types["Member"].properties["pronouns"]).toEqual({
      type: "string",
    });
  });
});
