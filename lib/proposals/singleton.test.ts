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
    // "by default" = no DATABASE_URL. Unset it explicitly so the test is
    // deterministic in-container (where DATABASE_URL IS set and the store would
    // otherwise be the Pg-backed one).
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    __resetProposalStoreForTests();
    try {
      const store = getProposalStore();
      expect(store).toBeInstanceOf(InMemoryProposalDraftStore);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      __resetProposalStoreForTests();
    }
  });

  it("__resetProposalStoreForTests yields a fresh instance", () => {
    __resetProposalStoreForTests();
    const before = getProposalStore();
    __resetProposalStoreForTests();
    const after = getProposalStore();
    expect(after).not.toBe(before);
  });
});
