import { describe, expect, it } from "vitest";
import { getProposalStore, __resetProposalStoreForTests } from "./singleton";
import { InMemoryProposalDraftStore } from "./store";

describe("getProposalStore", () => {
  it("returns the same instance across calls within a process", () => {
    __resetProposalStoreForTests();
    const a = getProposalStore();
    const b = getProposalStore();
    expect(a).toBe(b);
  });

  it("returns an InMemoryProposalDraftStore by default", () => {
    __resetProposalStoreForTests();
    const store = getProposalStore();
    expect(store).toBeInstanceOf(InMemoryProposalDraftStore);
  });

  it("__resetProposalStoreForTests yields a fresh instance", () => {
    __resetProposalStoreForTests();
    const before = getProposalStore();
    __resetProposalStoreForTests();
    const after = getProposalStore();
    expect(after).not.toBe(before);
  });
});
