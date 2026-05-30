import { describe, expect, it } from "vitest";
import type { Ontology } from "@/lib/ontology/schema";
import {
  validateViewProposal,
  InvalidViewProposalError,
} from "./validate-view-proposal";
import type { ViewConfigProposal } from "../views/view-proposal";
import { InMemoryProposalDraftStore } from "./store";
import { buildProposalTools } from "./tools";

// A minimal hand-built ontology with a single object type `Member` carrying a
// `full_name` field. deriveVocabulary turns this into validTypes=["member"],
// validFields={member:["id","full_name"]}. This is the SOURCE of the membership
// + field whitelist — no disk I/O, no hostel literals.
const ONTOLOGY = {
  properties: {},
  roles: {},
  object_types: {
    Member: {
      properties: {
        id: { type: "uuid", primary_key: true },
        full_name: { type: "string" },
      },
    },
  },
  link_types: {},
  action_types: {},
} as unknown as Ontology;

function viewWith(config: unknown): ViewConfigProposal {
  return {
    scope: "role",
    scope_key: "steward",
    descriptors: [{ id: "v1", kind: "metric", config }],
  } as ViewConfigProposal;
}

describe("validateViewProposal — fail loudly at propose time", () => {
  it("rejects a descriptor whose config references a non-existent type", () => {
    const result = validateViewProposal(
      viewWith({ type: "nonexistent_type", agg: "count" }),
      ONTOLOGY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unknown_type");
      // Surfaces WHICH descriptor + the offending detail so the steward/agent
      // sees a signal instead of a silent render-time no-op.
      expect(result.error).toContain("v1");
    }
  });

  it("rejects a descriptor whose config references a bogus field/column", () => {
    const result = validateViewProposal(
      {
        scope: "role",
        scope_key: "steward",
        descriptors: [
          {
            id: "tbl",
            kind: "data_table",
            config: { type: "member", columns: ["full_name", "no_such_col"] },
          },
        ],
      } as ViewConfigProposal,
      ONTOLOGY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unknown_columns");
      expect(result.error).toContain("tbl");
    }
  });

  it("accepts a descriptor whose config references a real live type + field", () => {
    const result = validateViewProposal(
      viewWith({ type: "member", agg: "count" }),
      ONTOLOGY,
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a descriptor referencing a type proposed in the SAME draft (overlay)", () => {
    // `thread` is NOT in the live ontology, but the draft introduces a Thread
    // object type in this same session. The overlay makes it valid — so the
    // legitimate 'propose a new type + a view of it' flow is not broken.
    const draftObjectTypes = {
      Thread: {
        properties: {
          id: { type: "uuid", primary_key: true },
          title: { type: "string" },
        },
      },
    } as unknown as Ontology["object_types"];
    const result = validateViewProposal(
      viewWith({ type: "thread", agg: "count" }),
      ONTOLOGY,
      draftObjectTypes,
    );
    expect(result.ok).toBe(true);
  });
});

// End-to-end at the LIVE enforcement point: the propose_view tool itself loads
// the live ontology and must THROW on a bogus descriptor before it can be staged
// (so it never reaches the steward queue), while a valid one stages cleanly.
describe("propose_view tool — live fence enforcement", () => {
  it("throws InvalidViewProposalError for a bogus type, leaving the draft empty", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_view } = buildProposalTools(store);
    await expect(
      propose_view.execute!(
        {
          session_id: "fence-s1",
          proposal: {
            scope: "role",
            scope_key: "steward",
            descriptors: [
              {
                id: "v1",
                kind: "metric",
                config: { type: "definitely_not_a_real_type", agg: "count" },
              },
            ],
          },
        },
        {},
      ),
    ).rejects.toBeInstanceOf(InvalidViewProposalError);
    // The bogus view never made it into the draft.
    expect(await store.getDraft("fence-s1")).toBeNull();
  });

  it("stages a valid descriptor referencing a real live type", async () => {
    const store = new InMemoryProposalDraftStore();
    const { propose_view } = buildProposalTools(store);
    const result = (await propose_view.execute!(
      {
        session_id: "fence-s2",
        proposal: {
          scope: "role",
          scope_key: "steward",
          descriptors: [
            { id: "v1", kind: "metric", config: { type: "member", agg: "count" } },
          ],
        },
      },
      {},
    )) as { ok: true; draft: { new_view_configs: Record<string, unknown> } };
    expect(result.ok).toBe(true);
    expect(result.draft.new_view_configs["role:steward"]).toBeDefined();
  });
});
