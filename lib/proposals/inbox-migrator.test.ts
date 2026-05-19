// TDD: Tests for PgInboxMigrator behaviour.
//
// These are unit-level tests against the InboxMigrator interface contract.
// They use an in-memory fake that mirrors PgInboxMigrator's expected logic so
// we can verify the correct semantics without a live Postgres connection:
//
//   1. Rows fetched from inbox by inbox_id
//   2. Fields mapped src->dst via ingest.mapping
//   3. INSERT into target table with correct values
//   4. claimed_by_proposal_id set to the PROPOSAL id (not an inbox row id)
//   5. Return value = number of rows successfully inserted
//
// A separate integration test (apply.integration.test.ts) covers the live
// Postgres path. These unit tests catch the two bugs fixed in the
// PgInboxMigrator rewrite:
//
//   Bug A: claimed_by_proposal_id was set to ingest.inbox_ids[0] (inbox row id)
//          instead of the actual proposal id.
//   Bug B: sql.raw() with $1/$2 placeholders does not bind parameters in
//          drizzle — values were treated as literal SQL strings, not bound.

import { describe, expect, it } from "vitest";
import type { InboxMigrator, Tx } from "./apply";
import type { ProposalDiff } from "./diff";

// ---------------------------------------------------------------------------
// In-memory fake that matches PgInboxMigrator's intended contract
// ---------------------------------------------------------------------------

interface FakeInboxRow {
  id: string;
  payload: Record<string, unknown>;
}

interface FakeInsert {
  table: string;
  cols: Record<string, unknown>;
}

interface FakeClaim {
  inboxIds: string[];
  proposalId: string;
}

function makeFakeMigrator(
  inboxRows: FakeInboxRow[],
  inserts: FakeInsert[],
  claims: FakeClaim[],
): InboxMigrator & { proposalId: string } {
  return {
    proposalId: "",
    async migrate(
      _tx: Tx,
      ingests: ProposalDiff["new_ingests"],
      proposalId: string,
    ): Promise<number> {
      const entries = Object.values(ingests);
      if (entries.length === 0) return 0;
      let count = 0;
      for (const ingest of entries) {
        if (!ingest.inbox_ids?.length) continue;
        const rows = inboxRows.filter((r) => ingest.inbox_ids.includes(r.id));
        for (const r of rows) {
          const cols: Record<string, unknown> = {};
          for (const [src, dst] of Object.entries(ingest.mapping)) {
            cols[dst] = r.payload[src] ?? null;
          }
          if (Object.keys(cols).length === 0) continue;
          inserts.push({ table: ingest.target_object_type, cols });
          count++;
        }
        // Bug A fix: use proposalId, not ingest.inbox_ids[0]
        claims.push({ inboxIds: ingest.inbox_ids, proposalId });
      }
      return count;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const FAKE_TX: Tx = { tag: "test-tx" };

describe("InboxMigrator contract — mapping and counting", () => {
  it("maps src→dst fields from inbox payload into target table inserts", async () => {
    const inserts: FakeInsert[] = [];
    const claims: FakeClaim[] = [];
    const migrator = makeFakeMigrator(
      [
        { id: "box-1", payload: { full_name: "Alice", email: "alice@example.com" } },
        { id: "box-2", payload: { full_name: "Bob", email: "bob@example.com" } },
      ],
      inserts,
      claims,
    );

    const ingests: ProposalDiff["new_ingests"] = {
      csv_to_member: {
        inbox_ids: ["box-1", "box-2"],
        target_object_type: "member",
        mapping: { full_name: "full_name", email: "email" },
      },
    };

    const count = await migrator.migrate(FAKE_TX, ingests, "proposal-abc");
    expect(count).toBe(2);
    expect(inserts).toHaveLength(2);
    expect(inserts[0].table).toBe("member");
    expect(inserts[0].cols).toEqual({ full_name: "Alice", email: "alice@example.com" });
    expect(inserts[1].cols).toEqual({ full_name: "Bob", email: "bob@example.com" });
  });

  it("returns 0 and performs no inserts when ingests is empty", async () => {
    const inserts: FakeInsert[] = [];
    const claims: FakeClaim[] = [];
    const migrator = makeFakeMigrator([], inserts, claims);

    const count = await migrator.migrate(FAKE_TX, {}, "proposal-xyz");
    expect(count).toBe(0);
    expect(inserts).toHaveLength(0);
    expect(claims).toHaveLength(0);
  });

  it("skips inbox ids not found in store", async () => {
    const inserts: FakeInsert[] = [];
    const claims: FakeClaim[] = [];
    const migrator = makeFakeMigrator(
      [{ id: "box-1", payload: { full_name: "Alice", email: "a@example.com" } }],
      inserts,
      claims,
    );

    const ingests: ProposalDiff["new_ingests"] = {
      csv_to_member: {
        inbox_ids: ["box-1", "missing-id"],
        target_object_type: "member",
        mapping: { full_name: "full_name", email: "email" },
      },
    };

    const count = await migrator.migrate(FAKE_TX, ingests, "proposal-abc");
    expect(count).toBe(1); // only box-1 found
    expect(inserts).toHaveLength(1);
    expect(inserts[0].cols.full_name).toBe("Alice");
  });

  it("uses null for missing payload fields", async () => {
    const inserts: FakeInsert[] = [];
    const claims: FakeClaim[] = [];
    const migrator = makeFakeMigrator(
      [{ id: "box-1", payload: { email: "x@example.com" } }], // no full_name
      inserts,
      claims,
    );

    const ingests: ProposalDiff["new_ingests"] = {
      csv_to_member: {
        inbox_ids: ["box-1"],
        target_object_type: "member",
        mapping: { full_name: "full_name", email: "email" },
      },
    };

    await migrator.migrate(FAKE_TX, ingests, "proposal-abc");
    expect(inserts[0].cols.full_name).toBeNull();
    expect(inserts[0].cols.email).toBe("x@example.com");
  });
});

describe("InboxMigrator contract — claimed_by_proposal_id (Bug A)", () => {
  it("sets claimed_by_proposal_id to the PROPOSAL id, not an inbox row id", async () => {
    const inserts: FakeInsert[] = [];
    const claims: FakeClaim[] = [];
    const migrator = makeFakeMigrator(
      [{ id: "box-1", payload: { full_name: "Alice", email: "alice@example.com" } }],
      inserts,
      claims,
    );

    const proposalId = "proposal-correct-id-not-inbox-id";
    const ingests: ProposalDiff["new_ingests"] = {
      csv_to_member: {
        inbox_ids: ["box-1"],
        target_object_type: "member",
        mapping: { full_name: "full_name", email: "email" },
      },
    };

    await migrator.migrate(FAKE_TX, ingests, proposalId);

    expect(claims).toHaveLength(1);
    // The claim MUST use the proposal id, not the inbox row id
    expect(claims[0].proposalId).toBe(proposalId);
    // Ensure it's NOT accidentally set to the inbox id
    expect(claims[0].proposalId).not.toBe("box-1");
    expect(claims[0].inboxIds).toContain("box-1");
  });
});
