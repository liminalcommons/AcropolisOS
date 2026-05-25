/**
 * A4 proof script — verify near-match dedup + resolve paths end-to-end.
 *
 * 4 cases:
 *   CASE 1 — Detect near-dup:
 *     Insert existing guest full_name='Marta López'; insert raw_inbox row;
 *     call commitProposalCore with full_name='Marta Lopez', no resolution.
 *     Assert: status==='duplicate_candidate', candidates includes Marta López
 *             (score ≥ 0.95), NO new guest row created, provenance NULL.
 *
 *   CASE 2 — Merge path:
 *     Same existing guest + raw_inbox row; call with resolution={merge_into:<marta_id>}.
 *     Assert: status==='merged', guest count for 'Marta%' unchanged (still 1),
 *             raw_inbox.classified_as==='guest' (marked processed).
 *
 *   CASE 3 — Create-new path:
 *     Same setup; call with resolution='create_new'.
 *     Assert: status==='committed', a 2nd guest row now exists.
 *
 *   CASE 4 — No-dup happy path:
 *     raw_inbox + guest proposal full_name='Zog Quux Unique' (no existing match),
 *     no resolution. Assert: status==='committed' directly (no duplicate_candidate).
 *
 * Usage: docker exec acropolisos-app npx tsx scripts/resolve-proof.ts
 */

import { randomUUID } from "node:crypto";
import { eq, like, sql } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { raw_inbox, action_audit } from "../lib/db/schema";
import { guest as guestTable, member as memberTable } from "../lib/db/schema.generated";
import { commitProposalCore } from "../lib/organize/commit";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error("  FAIL:", message);
    process.exit(1);
  }
  console.log("  PASS:", message);
}

// Minimal steward identity for proof
const STEWARD_ID = "steward-a4-proof";

async function main() {
  const db = createDb(DATABASE_URL!);

  // ─────────────────────────────────────────────────────────────────────────────
  // Shared setup: disposable existing guest row (Marta López — with diacritic)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n=== SETUP: Insert existing guest 'Marta López' ===");
  const martaId = randomUUID();
  await db.insert(guestTable).values({
    id: martaId,
    full_name: "Marta López",
    email: "marta@test.local",
    country: "ES",
    phone: "000",
    arrived_at: "2026-01-01",
    expected_departure: "2026-01-08",
    current_status: "booked",
    is_work_trader: false,
  });
  console.log("  Inserted guest id:", martaId, "full_name: Marta López");

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE 1 — Detect near-dup (no resolution)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n=== CASE 1: Detect near-dup (no resolution) ===");

  const inbox1Id = randomUUID();
  await db.insert(raw_inbox).values({
    id: inbox1Id,
    source: "test-a4-case1",
    payload: { full_name: "Marta Lopez", notes: "incoming dup no email" },
  });
  console.log("  Inserted raw_inbox id:", inbox1Id);

  const result1 = await commitProposalCore(db, "steward", STEWARD_ID, {
    inbox_id: inbox1Id,
    target_type: "guest",
    field_map: { full_name: "full_name" },
    confidence: 0.8,
    unmapped: ["notes"],
    reasoning: "test",
  });
  console.log("  Result:", JSON.stringify(result1, null, 2));

  assert(result1.status === "duplicate_candidate", `status === 'duplicate_candidate' (got: ${result1.status})`);

  const candidates = result1.status === "duplicate_candidate" ? result1.candidates : [];
  const martaCandidate = candidates.find((c) => c.id === martaId);
  assert(
    martaCandidate !== undefined,
    `candidates includes Marta López row (id: ${martaId})`,
  );
  assert(
    (martaCandidate?.score ?? 0) >= 0.95,
    `Marta López candidate score >= 0.95 (got: ${martaCandidate?.score})`,
  );

  // Verify NO new guest row created — count for 'Marta L%' is still exactly 1 (the setup row)
  const guestCountAfterCase1 = await db
    .select()
    .from(guestTable)
    .where(like(guestTable.full_name, "Marta L%"));
  assert(
    guestCountAfterCase1.length === 1,
    `NO new guest row created — still 1 'Marta L*' row (got: ${guestCountAfterCase1.length})`,
  );

  // Verify provenance NULL (raw_inbox not stamped)
  const inbox1Rows = await db.select().from(raw_inbox).where(eq(raw_inbox.id, inbox1Id));
  assert(
    inbox1Rows[0]?.classified_as === null || inbox1Rows[0]?.classified_as === undefined,
    `raw_inbox.classified_as is NULL (provenance NOT stamped) — got: ${inbox1Rows[0]?.classified_as}`,
  );

  console.log("CASE 1 — PASS\n");

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE 2 — Merge path (resolution = { merge_into: martaId })
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("=== CASE 2: Merge path ===");

  const inbox2Id = randomUUID();
  await db.insert(raw_inbox).values({
    id: inbox2Id,
    source: "test-a4-case2",
    payload: { full_name: "Marta Lopez", notes: "incoming dup to merge" },
  });
  console.log("  Inserted raw_inbox id:", inbox2Id);

  const result2 = await commitProposalCore(
    db,
    "steward",
    STEWARD_ID,
    {
      inbox_id: inbox2Id,
      target_type: "guest",
      field_map: { full_name: "full_name" },
      confidence: 0.8,
      unmapped: ["notes"],
      reasoning: "test",
    },
    { merge_into: martaId },
  );
  console.log("  Result:", JSON.stringify(result2));

  assert(result2.status === "merged", `status === 'merged' (got: ${result2.status})`);
  assert(
    result2.status === "merged" && result2.merged_into === martaId,
    `merged_into === martaId`,
  );

  // Guest count for 'Marta L%' UNCHANGED (still 1 — no 2nd row)
  const guestCountAfterMerge = await db
    .select()
    .from(guestTable)
    .where(like(guestTable.full_name, "Marta L%"));
  assert(
    guestCountAfterMerge.length === 1,
    `guest count for 'Marta L%' unchanged — still 1 (got: ${guestCountAfterMerge.length})`,
  );

  // raw_inbox.classified_as === 'guest' (marked processed)
  const inbox2Rows = await db.select().from(raw_inbox).where(eq(raw_inbox.id, inbox2Id));
  assert(
    inbox2Rows[0]?.classified_as === "guest",
    `raw_inbox.classified_as === 'guest' after merge (got: ${inbox2Rows[0]?.classified_as})`,
  );

  console.log("CASE 2 — PASS\n");

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE 3 — Create-new path (resolution = 'create_new')
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("=== CASE 3: Create-new path ===");

  const inbox3Id = randomUUID();
  await db.insert(raw_inbox).values({
    id: inbox3Id,
    source: "test-a4-case3",
    // Include email so the guest insert satisfies the NOT NULL constraint.
    // field_map maps both full_name and email.
    payload: { full_name: "Marta Lopez", email: "marta2@test.local", notes: "explicit create new" },
  });
  console.log("  Inserted raw_inbox id:", inbox3Id);

  const result3 = await commitProposalCore(
    db,
    "steward",
    STEWARD_ID,
    {
      inbox_id: inbox3Id,
      target_type: "guest",
      field_map: { full_name: "full_name", email: "email" },
      confidence: 0.8,
      unmapped: ["notes"],
      reasoning: "test",
    },
    "create_new",
  );
  console.log("  Result:", JSON.stringify(result3));

  assert(result3.status === "committed", `status === 'committed' (got: ${result3.status})`);

  // A 2nd guest row now exists for 'Marta L%' (setup row + new create_new row)
  const guestCountAfterCreateNew = await db
    .select()
    .from(guestTable)
    .where(like(guestTable.full_name, "Marta L%"));
  assert(
    guestCountAfterCreateNew.length === 2,
    `2nd guest row now exists — count for 'Marta L%' === 2 (got: ${guestCountAfterCreateNew.length})`,
  );

  const newGuestId = result3.status === "committed" ? result3.typed_row_id : null;

  console.log("CASE 3 — PASS\n");

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE 4 — No-dup happy path (no resolution, unique name)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("=== CASE 4: No-dup happy path ===");

  const inbox4Id = randomUUID();
  await db.insert(raw_inbox).values({
    id: inbox4Id,
    source: "test-a4-case4",
    // Include email so guest insert satisfies NOT NULL constraint.
    payload: { full_name: "Zog Quux Unique", email: "zog@test.local", notes: "unique person" },
  });
  console.log("  Inserted raw_inbox id:", inbox4Id);

  const result4 = await commitProposalCore(db, "steward", STEWARD_ID, {
    inbox_id: inbox4Id,
    target_type: "guest",
    field_map: { full_name: "full_name", email: "email" },
    confidence: 0.9,
    unmapped: ["notes"],
    reasoning: "test",
  });
  console.log("  Result:", JSON.stringify(result4));

  assert(
    result4.status === "committed",
    `status === 'committed' directly (no duplicate_candidate) — got: ${result4.status}`,
  );

  const zogGuestId = result4.status === "committed" ? result4.typed_row_id : null;

  console.log("CASE 4 — PASS\n");

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE 5 — Bogus merge target (random UUID, no matching row)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("=== CASE 5: Bogus merge target (random UUID) ===");

  const inbox5Id = randomUUID();
  await db.insert(raw_inbox).values({
    id: inbox5Id,
    source: "test-a4-case5",
    payload: { full_name: "Bogus Test Person", email: "bogus@test.local" },
  });
  console.log("  Inserted raw_inbox id:", inbox5Id);

  const bogusId = randomUUID(); // random UUID — no matching row in any table
  const result5 = await commitProposalCore(
    db,
    "steward",
    STEWARD_ID,
    {
      inbox_id: inbox5Id,
      target_type: "guest",
      field_map: { full_name: "full_name", email: "email" },
      confidence: 0.8,
      unmapped: [],
      reasoning: "test bogus merge",
    },
    { merge_into: bogusId },
  );
  console.log("  Result:", JSON.stringify(result5));

  assert(
    result5.status === "merge_target_not_found",
    `status === 'merge_target_not_found' (got: ${result5.status})`,
  );
  assert(
    result5.status === "merge_target_not_found" && result5.merge_into === bogusId,
    `merge_into reflects the bogus id`,
  );

  // classified_as must remain NULL — data preserved, re-resolvable
  const inbox5Rows = await db.select().from(raw_inbox).where(eq(raw_inbox.id, inbox5Id));
  assert(
    inbox5Rows[0]?.classified_as === null || inbox5Rows[0]?.classified_as === undefined,
    `raw_inbox.classified_as is NULL after bogus merge (data preserved) — got: ${inbox5Rows[0]?.classified_as}`,
  );

  console.log("CASE 5 — PASS\n");

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE 6 — Cross-type merge target (member id used when target_type='guest')
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("=== CASE 6: Cross-type merge target (member id, guest target_type) ===");

  // Insert a disposable member row
  const disposableMemberId = randomUUID();
  await db.insert(memberTable).values({
    id: disposableMemberId,
    full_name: "Test Member for Case6",
    email: "member-case6@test.local",
    phone: "000",
    tier_role: "staff",
    started_at: "2026-01-01",
  });
  console.log("  Inserted disposable member id:", disposableMemberId);

  const inbox6Id = randomUUID();
  await db.insert(raw_inbox).values({
    id: inbox6Id,
    source: "test-a4-case6",
    payload: { full_name: "Cross Type Person", email: "crosstype@test.local" },
  });
  console.log("  Inserted raw_inbox id:", inbox6Id);

  // merge_into = member id, but target_type = 'guest' → cross-type, must reject
  const result6 = await commitProposalCore(
    db,
    "steward",
    STEWARD_ID,
    {
      inbox_id: inbox6Id,
      target_type: "guest",
      field_map: { full_name: "full_name", email: "email" },
      confidence: 0.8,
      unmapped: [],
      reasoning: "test cross-type merge",
    },
    { merge_into: disposableMemberId },
  );
  console.log("  Result:", JSON.stringify(result6));

  assert(
    result6.status === "merge_target_not_found",
    `status === 'merge_target_not_found' for cross-type id (got: ${result6.status})`,
  );

  // classified_as must remain NULL — member id is not a valid guest
  const inbox6Rows = await db.select().from(raw_inbox).where(eq(raw_inbox.id, inbox6Id));
  assert(
    inbox6Rows[0]?.classified_as === null || inbox6Rows[0]?.classified_as === undefined,
    `raw_inbox.classified_as is NULL after cross-type merge (data preserved) — got: ${inbox6Rows[0]?.classified_as}`,
  );

  console.log("CASE 6 — PASS\n");

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE 7 — Valid merge still works (regression guard + audit persistence check)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("=== CASE 7: Valid merge regression (existing guest + audit persistence) ===");

  // Insert another disposable guest as the canonical target
  const canonicalGuestId = randomUUID();
  await db.insert(guestTable).values({
    id: canonicalGuestId,
    full_name: "Canonical Guest Case7",
    email: "canonical-case7@test.local",
    country: "DE",
    phone: "000",
    arrived_at: "2026-01-01",
    expected_departure: "2026-01-08",
    current_status: "booked",
    is_work_trader: false,
  });
  console.log("  Inserted canonical guest id:", canonicalGuestId);

  const inbox7Id = randomUUID();
  await db.insert(raw_inbox).values({
    id: inbox7Id,
    source: "test-a4-case7",
    payload: { full_name: "Canonical Guest Case7 dup", email: "canonical-case7-dup@test.local" },
  });
  console.log("  Inserted raw_inbox id:", inbox7Id);

  const result7 = await commitProposalCore(
    db,
    "steward",
    STEWARD_ID,
    {
      inbox_id: inbox7Id,
      target_type: "guest",
      field_map: { full_name: "full_name", email: "email" },
      confidence: 0.85,
      unmapped: [],
      reasoning: "test valid merge regression",
    },
    { merge_into: canonicalGuestId },
  );
  console.log("  Result:", JSON.stringify(result7));

  assert(result7.status === "merged", `status === 'merged' for valid guest id (got: ${result7.status})`);
  assert(
    result7.status === "merged" && result7.merged_into === canonicalGuestId,
    `merged_into === canonicalGuestId`,
  );

  // No 2nd guest row created
  const guestCountCase7 = await db
    .select()
    .from(guestTable)
    .where(like(guestTable.full_name, "Canonical Guest Case7%"));
  assert(
    guestCountCase7.length === 1,
    `no 2nd guest row created — count for 'Canonical Guest Case7%' === 1 (got: ${guestCountCase7.length})`,
  );

  // raw_inbox.classified_as === 'guest'
  const inbox7Rows = await db.select().from(raw_inbox).where(eq(raw_inbox.id, inbox7Id));
  assert(
    inbox7Rows[0]?.classified_as === "guest",
    `raw_inbox.classified_as === 'guest' after valid merge (got: ${inbox7Rows[0]?.classified_as})`,
  );

  // Audit row persisted in action_audit
  const auditRows = await db
    .select()
    .from(action_audit)
    .where(eq(action_audit.via, "commitProposalCore/merge_into"));
  const matchingAudit = auditRows.find(
    (r) =>
      (r.metadata as Record<string, unknown>)?.inbox_id === inbox7Id &&
      (r.metadata as Record<string, unknown>)?.merged_into === canonicalGuestId,
  );
  assert(
    matchingAudit !== undefined,
    `action_audit row persisted for merge (inbox_id=${inbox7Id} → merged_into=${canonicalGuestId})`,
  );

  console.log("CASE 7 — PASS\n");

  // ─────────────────────────────────────────────────────────────────────────────
  // CLEANUP — ALL disposable rows
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("=== CLEANUP ===");

  // Delete the 2nd Marta guest (case 3 create_new)
  if (newGuestId) {
    await db.delete(guestTable).where(eq(guestTable.id, newGuestId));
    console.log("  Deleted case-3 guest row:", newGuestId);
  }

  // Delete the Zog guest (case 4)
  if (zogGuestId) {
    await db.delete(guestTable).where(eq(guestTable.id, zogGuestId));
    console.log("  Deleted case-4 guest row:", zogGuestId);
  }

  // Delete the original Marta López guest (setup)
  await db.delete(guestTable).where(eq(guestTable.id, martaId));
  console.log("  Deleted setup Marta López guest row:", martaId);

  // Delete case-5 raw_inbox (classified_as=NULL, no typed row created)
  await db.delete(raw_inbox).where(eq(raw_inbox.id, inbox5Id));
  console.log("  Deleted case-5 raw_inbox row:", inbox5Id);

  // Delete case-6 disposable member + raw_inbox
  await db.delete(memberTable).where(eq(memberTable.id, disposableMemberId));
  console.log("  Deleted case-6 member row:", disposableMemberId);
  await db.delete(raw_inbox).where(eq(raw_inbox.id, inbox6Id));
  console.log("  Deleted case-6 raw_inbox row:", inbox6Id);

  // Delete case-7 canonical guest + raw_inbox + audit row
  await db.delete(guestTable).where(eq(guestTable.id, canonicalGuestId));
  console.log("  Deleted case-7 canonical guest row:", canonicalGuestId);
  await db.delete(raw_inbox).where(eq(raw_inbox.id, inbox7Id));
  console.log("  Deleted case-7 raw_inbox row:", inbox7Id);
  if (matchingAudit) {
    await db.delete(action_audit).where(eq(action_audit.id, matchingAudit.id));
    console.log("  Deleted case-7 action_audit row:", matchingAudit.id);
  }

  // Delete all original raw_inbox test rows (cases 1-4)
  await db.delete(raw_inbox).where(eq(raw_inbox.id, inbox1Id));
  await db.delete(raw_inbox).where(eq(raw_inbox.id, inbox2Id));
  await db.delete(raw_inbox).where(eq(raw_inbox.id, inbox3Id));
  await db.delete(raw_inbox).where(eq(raw_inbox.id, inbox4Id));
  console.log("  Deleted 4 original raw_inbox test rows (cases 1-4)");

  console.log("\n=== A4 PROOF COMPLETE — ALL 7 CASES PASS ===");

  await (db.$client as { end: () => Promise<void> }).end();
  process.exit(0);
}

main().catch((err) => {
  console.error("PROOF FAILED:", err);
  process.exit(1);
});
