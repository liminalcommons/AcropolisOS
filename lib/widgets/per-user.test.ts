// per-user.test.ts — VALIDATION-ERROR SURFACING in the render path.
//
// GOVERNANCE THESIS: ontology drift (a type renamed/removed, a field deleted)
// must NOT silently drop a configured widget. Before this change resolveDescriptors
// ran `if (!validation.ok) continue;` — a stale descriptor vanished without a
// trace, so a steward never learned their pinned view broke. That violates the
// "the human governs structural change" contract: a broken view is a structural
// signal the steward must SEE.
//
// After this change a descriptor whose config fails validateWidgetConfig is
// returned as a ResolvedWidget with data:null + validation_error:{kind,error}
// instead of being skipped. The renderer shows an error card.
//
// DB-free: resolveDescriptors takes descriptors directly (no member_context read),
// so a stub `{} as never` db never gets touched for the validation-failure path
// (the widget short-circuits at validation, before any queryBinding/SQL).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";

const SMALL = path.resolve(__dirname, "..", "..", "scenarios", "small-community", "ontology");

// Stub the read-only api so a VALID descriptor's queryBinding returns data
// without a live DB. The validation-failure path short-circuits BEFORE the api
// is used, so the stub only matters for the partial-invalid "good survives" case.
vi.mock("@/lib/widgets/read-api", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/widgets/read-api")>();
  // A vi.fn() (not a plain arrow) so individual tests can override the returned
  // api per-call via mockReturnValueOnce (e.g. the throwing-binding case). The
  // default implementation is the original non-throwing stub.
  return {
    ...actual,
    createReadOnlyDataApi: vi.fn(() => ({
      count: async () => 3,
      select: async () => ({ columns: [], rows: [] }),
      byDate: async () => [],
      communityIntelligence: async () => ({
        autonomyRatio: 0,
        scenarioAcceptanceRate: 0,
        decisionLatencyMsMedian: null,
        coordinationCoverage: 0,
        resolutionAccuracy: 0,
      }),
    })),
  };
});

import { resolveDescriptors } from "@/lib/widgets/per-user";
import { createReadOnlyDataApi } from "@/lib/widgets/read-api";

describe("resolveDescriptors — surfaces validation errors instead of dropping widgets", () => {
  const prev = process.env.ACROPOLISOS_ONTOLOGY_DIR;
  beforeAll(() => {
    process.env.ACROPOLISOS_ONTOLOGY_DIR = SMALL;
  });
  afterAll(() => {
    process.env.ACROPOLISOS_ONTOLOGY_DIR = prev;
  });

  it("surfaces a validation error when ontology drift removes a type", async () => {
    // A data_table pinned on a type that no longer exists in the loaded ontology
    // (simulates a type rename/removal — classic structural drift).
    const out = await resolveDescriptors(
      {} as never,
      [{ id: "stale-table", kind: "data_table", config: { type: "old_type", columns: ["x"] } }],
      () => true,
    );

    expect(out).toHaveLength(1); // NOT dropped
    const w = out[0];
    expect(w.kind).toBe("data_table");
    expect(w.data).toBeNull();
    expect(w.validation_error).toBeTruthy();
    expect(w.validation_error?.kind).toBe("unknown_type");
    // The error payload names the offending type so the steward can act on it.
    expect(JSON.stringify(w.validation_error?.error)).toContain("old_type");
  });

  it("surfaces a validation error when a field is deleted from an existing type", async () => {
    // The type survives but a column it references was removed → unknown_columns.
    const out = await resolveDescriptors(
      {} as never,
      [{ id: "stale-col", kind: "data_table", config: { type: "member", columns: ["deleted_field"] } }],
      () => true,
    );

    expect(out).toHaveLength(1);
    const w = out[0];
    expect(w.data).toBeNull();
    expect(w.validation_error?.kind).toBe("unknown_columns");
    expect(JSON.stringify(w.validation_error?.error)).toContain("deleted_field");
  });

  it("a valid descriptor alongside a broken one BOTH survive (partial-invalid is visible, not lossy)", async () => {
    const out = await resolveDescriptors(
      {} as never,
      [
        { id: "good", kind: "metric", config: { type: "member", agg: "count" } },
        { id: "bad", kind: "metric", config: { type: "ghost_type", agg: "count" } },
      ],
      () => true,
    );

    expect(out).toHaveLength(2);
    const good = out.find((w) => w.id === "good");
    const bad = out.find((w) => w.id === "bad");
    expect(good?.validation_error).toBeUndefined();
    expect(good?.data).not.toBeNull();
    expect(bad?.validation_error?.kind).toBe("unknown_type");
    expect(bad?.data).toBeNull();
  });

  it("the validation_error payload is JSON-serializable (no circular refs / Zod issue objects)", async () => {
    const out = await resolveDescriptors(
      {} as never,
      [{ id: "bad", kind: "data_table", config: { type: "still_gone", columns: ["x"] } }],
      () => true,
    );
    expect(() => JSON.stringify(out[0])).not.toThrow();
    const round = JSON.parse(JSON.stringify(out[0]));
    expect(round.validation_error.kind).toBe("unknown_type");
  });
});

describe("resolveDescriptors — a throwing data binding becomes a status:error widget (not dropped)", () => {
  const prev = process.env.ACROPOLISOS_ONTOLOGY_DIR;
  beforeAll(() => {
    process.env.ACROPOLISOS_ONTOLOGY_DIR = SMALL;
  });
  afterAll(() => {
    process.env.ACROPOLISOS_ONTOLOGY_DIR = prev;
  });

  it("surfaces an error widget and does NOT drop it or throw", async () => {
    // A valid metric descriptor (passes validateWidgetConfig) whose queryBinding
    // throws because the db rejects every query. The widget must SURVIVE as
    // status:"error", length preserved, with a generic (non-leaky) message.
    //
    // PLUMBING NOTE: this file module-mocks read-api's createReadOnlyDataApi, so a
    // throwing raw db handle never reaches a real api (the factory ignores `db`).
    // Per the plan's implementer note ("only the stub plumbing may change; the
    // TEST CONTRACT is fixed"), we instead override the mocked factory for this one
    // call to return an api whose count() throws — metric's queryBinding calls
    // api.count(), so this genuinely drives the resolve into the catch site. The
    // raw error text carries an internal detail to assert it is NOT surfaced.
    vi.mocked(createReadOnlyDataApi).mockReturnValueOnce({
      count: async () => {
        throw new Error("db down: relation does not exist");
      },
      select: async () => {
        throw new Error("db down");
      },
      selectByIds: async () => {
        throw new Error("db down");
      },
      byDate: async () => {
        throw new Error("db down");
      },
      communityIntelligence: async () => {
        throw new Error("db down");
      },
    });
    const descriptors = [{ id: "w1", kind: "metric", config: { type: "member", agg: "count" } }];
    const out = await resolveDescriptors({} as never, descriptors, () => true);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("error");
    expect(out[0].data).toBeNull();
    expect(out[0].error?.message).toBeTruthy();
    // viewer-safe: the raw exception text must NOT be surfaced
    expect(out[0].error?.message).not.toContain("relation does not exist");
  });
});
