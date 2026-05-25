/**
 * A3 proof script — verify commitProposalCore end-to-end without HTTP.
 *
 * Sequence:
 *   1. INSERT a disposable raw_inbox row (source='test-a3').
 *   2. Call commitProposalCore as a steward actor.
 *   3. ASSERT: guest row with full_name='ZZTest Person' exists.
 *   4. ASSERT: raw_inbox row has classified_as='guest', classified_at set, classified_by set.
 *   5. Call commitProposalCore a SECOND time on the same inbox_id.
 *   6. ASSERT: returns { status:"already_classified" } AND guest count is still 1.
 *   7. CLEANUP: delete the test guest row + test raw_inbox row.
 *
 * Usage: docker exec acropolisos-app npx tsx scripts/confirm-proof.ts
 */

import { randomUUID } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { raw_inbox } from "../lib/db/schema";
import { guest as guestTable } from "../lib/db/schema.generated";
import { commitProposalCore } from "../lib/organize/commit";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error("ASSERTION FAILED:", message);
    process.exit(1);
  }
  console.log("  PASS:", message);
}

async function main() {
  const db = createDb(DATABASE_URL!);

  // ── 1. INSERT disposable raw_inbox row ──────────────────────────────────────
  console.log("\n=== STEP 1: Insert disposable raw_inbox row ===");
  const inboxId = randomUUID();
  await db.insert(raw_inbox).values({
    id: inboxId,
    source: "test-a3",
    payload: { name: "ZZTest Person", email: "zz@test.local" },
  });
  console.log("  Inserted raw_inbox id:", inboxId);

  // ── 2. Call commitProposalCore (steward actor) ───────────────────────────────
  console.log("\n=== STEP 2: commitProposalCore (steward, first call) ===");
  const stewardId = "steward-proof-actor";
  const proposal = {
    inbox_id: inboxId,
    target_type: "guest" as const,
    field_map: { name: "full_name", email: "email" },
    confidence: 0.9,
    unmapped: [],
    reasoning: "test",
  };

  const result1 = await commitProposalCore(db, "steward", stewardId, proposal);
  console.log("  Result:", JSON.stringify(result1));

  // ── 3. ASSERT: guest row with full_name='ZZTest Person' exists ───────────────
  console.log("\n=== STEP 3: Verify guest row written ===");
  assert(result1.status === "committed", "first call status === committed");

  const typedRowId = result1.status === "committed" ? result1.typed_row_id : null;
  assert(typedRowId !== null, "typed_row_id is set");

  const guestRows = await db
    .select()
    .from(guestTable)
    .where(eq(guestTable.id, typedRowId!));

  assert(guestRows.length === 1, "guest row count === 1");
  assert(
    guestRows[0].full_name === "ZZTest Person",
    `guest.full_name === 'ZZTest Person' (got: ${guestRows[0].full_name})`,
  );
  assert(
    guestRows[0].email === "zz@test.local",
    `guest.email === 'zz@test.local' (got: ${guestRows[0].email})`,
  );
  console.log("  guest row:", JSON.stringify({
    id: guestRows[0].id,
    full_name: guestRows[0].full_name,
    email: guestRows[0].email,
  }));

  // ── 4. ASSERT: raw_inbox provenance columns set ──────────────────────────────
  console.log("\n=== STEP 4: Verify raw_inbox provenance ===");
  const inboxRows = await db
    .select()
    .from(raw_inbox)
    .where(eq(raw_inbox.id, inboxId));

  assert(inboxRows.length === 1, "inbox row exists");
  assert(inboxRows[0].classified_as === "guest", `classified_as === 'guest' (got: ${inboxRows[0].classified_as})`);
  assert(inboxRows[0].classified_at !== null, "classified_at is set");
  assert(inboxRows[0].classified_by === stewardId, `classified_by === '${stewardId}' (got: ${inboxRows[0].classified_by})`);

  console.log("  Provenance:", JSON.stringify({
    classified_as: inboxRows[0].classified_as,
    classified_at: inboxRows[0].classified_at,
    classified_by: inboxRows[0].classified_by,
  }));

  // ── 5. SECOND CALL — must return already_classified ──────────────────────────
  console.log("\n=== STEP 5: Second call (idempotency check) ===");
  const result2 = await commitProposalCore(db, "steward", stewardId, proposal);
  console.log("  Result:", JSON.stringify(result2));

  // ── 6. ASSERT: no-op + count still 1 ────────────────────────────────────────
  console.log("\n=== STEP 6: Assert idempotency ===");
  assert(result2.status === "already_classified", `second call status === 'already_classified' (got: ${result2.status})`);

  // Verify count: only 1 guest row for ZZTest Person
  const allZZGuests = await db
    .select()
    .from(guestTable)
    .where(eq(guestTable.full_name, "ZZTest Person"));
  assert(allZZGuests.length === 1, `guest count for 'ZZTest Person' === 1 (no double-write), got: ${allZZGuests.length}`);

  // ── 7. CLEANUP ───────────────────────────────────────────────────────────────
  console.log("\n=== STEP 7: Cleanup ===");
  if (typedRowId) {
    await db.delete(guestTable).where(eq(guestTable.id, typedRowId));
    console.log("  Deleted guest row:", typedRowId);
  }
  await db.delete(raw_inbox).where(eq(raw_inbox.id, inboxId));
  console.log("  Deleted raw_inbox row:", inboxId);

  console.log("\ncleanup done");
  console.log("\n=== A3 PROOF COMPLETE ===");

  await (db.$client as { end: () => Promise<void> }).end();
  process.exit(0);
}

main().catch((err) => {
  console.error("PROOF FAILED:", err);
  process.exit(1);
});
