// bug_merge_dataloss — the merge_into path must not silently discard fields the
// incoming duplicate carried but the canonical row lacks.
//
// Before this fix, commitProposalCore(..., { merge_into }) stamped provenance on
// raw_inbox and wrote an action_audit row whose metadata held only
// { inbox_id, merged_into, target_type } — the incoming payload (e.g. a phone
// number the canonical row was missing) was dropped with no trace. A steward
// could never recover what the duplicate contributed.
//
// The fix reads the inbox payload, maps it through field_map, and records it as
// metadata.incomingFields on the merge audit row, so the contribution is
// inspectable later. This test asserts that contract via a captured audit insert.

import { describe, expect, it, vi } from "vitest";

// getOntologyCached → pass-through to loadOntology (avoids next-auth).
vi.mock("@/lib/agent/chat-runtime", async () => {
  const { loadOntology } = await import("@/lib/ontology/load");
  return { getOntologyCached: (dir: string) => loadOntology(dir) };
});
// Use the REAL runtime ontology (hostel) — `guest` is a valid type with a TABLES
// entry, so resolveTargetTable succeeds and we reach the merge path.

import { commitProposalCore } from "./commit";
import type { Database } from "../db/client";

const INBOX_ID = "22222222-2222-4222-8222-222222222222";
const CANONICAL_ID = "33333333-3333-4333-8333-333333333333";

// The incoming duplicate carried a phone the canonical guest row lacks.
const INCOMING_PAYLOAD = {
  name: "Ada Lovelace",
  mail: "ada@example.com",
  tel: "+44 20 7946 0958",
};
const FIELD_MAP = { name: "full_name", mail: "email", tel: "phone" };

function mergeDb(): { db: Database; auditInserts: unknown[] } {
  const auditInserts: unknown[] = [];
  const db = {
    execute: async (query: unknown) => {
      const chunks =
        (query as { queryChunks?: Array<{ value?: unknown }> }).queryChunks ??
        [];
      const text = chunks
        .map((c) => (Array.isArray(c.value) ? c.value.join(" ") : ""))
        .join(" ")
        .toUpperCase();
      // Target-exists probe: SELECT 1 FROM "guest" WHERE id = ...
      if (text.includes("SELECT 1 FROM")) return [{ "?column?": 1 }];
      // Inbox classified_as check (no FOR UPDATE, plain SELECT classified_as).
      if (text.includes("SELECT CLASSIFIED_AS FROM RAW_INBOX")) {
        return [{ classified_as: null }];
      }
      // Provenance UPDATE ... RETURNING id → one row touched.
      if (text.includes("UPDATE RAW_INBOX")) return [{ id: INBOX_ID }];
      // Payload read (for incomingFields preservation).
      if (text.includes("SELECT PAYLOAD FROM RAW_INBOX")) {
        return [{ payload: INCOMING_PAYLOAD }];
      }
      return [];
    },
    insert: (_table: unknown) => ({
      values: async (obj: unknown) => {
        auditInserts.push(obj);
      },
    }),
  } as unknown as Database;
  return { db, auditInserts };
}

describe("commitProposalCore — merge_into preserves the incoming payload", () => {
  it("records the mapped incoming fields in the merge audit metadata", async () => {
    const { db, auditInserts } = mergeDb();
    const result = await commitProposalCore(
      db,
      "steward",
      "actor-1",
      {
        inbox_id: INBOX_ID,
        target_type: "guest",
        field_map: FIELD_MAP,
        confidence: 1,
        unmapped: [],
        reasoning: "merge into existing guest",
      },
      { merge_into: CANONICAL_ID },
    );

    expect(result.status).toBe("merged");
    if (result.status === "merged") {
      expect(result.merged_into).toBe(CANONICAL_ID);
    }

    // Exactly one audit row was written, and it preserves the incoming fields.
    expect(auditInserts).toHaveLength(1);
    const audit = auditInserts[0] as {
      subject_id: string;
      metadata: {
        inbox_id: string;
        merged_into: string;
        target_type: string;
        incomingFields: Record<string, unknown>;
      };
    };
    expect(audit.subject_id).toBe(CANONICAL_ID);
    expect(audit.metadata.merged_into).toBe(CANONICAL_ID);
    // The phone the canonical row lacked is NOT discarded — it is preserved
    // (mapped through field_map: tel -> phone) for later steward inspection.
    expect(audit.metadata.incomingFields).toMatchObject({
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+44 20 7946 0958",
    });
  });
});
