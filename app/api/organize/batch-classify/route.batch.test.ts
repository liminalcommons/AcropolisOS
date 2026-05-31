// app/api/organize/batch-classify/route.batch.test.ts
//
// Unit tests for the PURE helpers exported by the batch-classify route:
//   - mergeSampleKeys: union of payload keys across a sample of rows (so the
//     LLM sees every column that appears anywhere in the source, not just the
//     first row's columns).
//   - chunk: splits an array into fixed-size slices for chunked bulk apply
//     (stays under the pg 65535-param ceiling).
//
// Heavy transitive deps (chat-runtime/db/ai) are mocked so the route module
// imports cleanly in a pure vitest environment — mirrors route.derive.test.ts.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: vi.fn(),
  isAnonymous: vi.fn(() => false),
  getOntologyCached: vi.fn(),
  ANONYMOUS_ACTOR: { userId: "anonymous", email: "", role: "anonymous", customRoles: [] },
}));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/db/schema", () => ({ raw_inbox: {} }));
vi.mock("@/lib/agent/mastra", () => ({ buildLanguageModel: vi.fn() }));
vi.mock("@/lib/agent/extract-json", () => ({ extractJson: vi.fn() }));
vi.mock("ai", () => ({ generateText: vi.fn() }));
// classify route is re-used for buildTargetVocab/validateFieldMap — stub it so
// importing the batch route does not transitively pull the live ontology/db.
vi.mock("@/app/api/organize/classify/route", () => ({
  buildTargetVocab: vi.fn(),
  validateFieldMap: vi.fn(() => ({ ok: true })),
}));

import { mergeSampleKeys, chunk } from "@/app/api/organize/batch-classify/route";

describe("mergeSampleKeys", () => {
  it("unions keys across rows with differing key sets", () => {
    const rows = [
      { payload: { name: "a", email: "x" } },
      { payload: { name: "b", phone: "555" } },
      { payload: { name: "c", email: "y", country: "BR" } },
    ];
    const keys = mergeSampleKeys(rows);
    expect(keys.sort()).toEqual(["country", "email", "name", "phone"]);
  });

  it("ignores non-object payloads (null / array / scalar) without throwing", () => {
    const rows = [
      { payload: { a: 1 } },
      { payload: null },
      { payload: [1, 2, 3] },
      { payload: "plain string" },
      { payload: 42 },
    ];
    expect(mergeSampleKeys(rows)).toEqual(["a"]);
  });

  it("returns [] for an empty sample", () => {
    expect(mergeSampleKeys([])).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits into fixed-size slices, last slice may be smaller", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single slice when size >= length", () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("returns [] for an empty array", () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it("throws on a non-positive size rather than looping forever", () => {
    expect(() => chunk([1, 2], 0)).toThrow();
  });
});
