/**
 * seed-scale-community.ts
 *
 * Populates ~300 simulated Members, each with a MemberContext (per-member
 * knowledge base / context slice). M3 deliverable #2: prototype with hundreds
 * of agents, each with a rudimentary knowledge base.
 *
 * Design contract:
 *   - IDEMPOTENT: cleanup runs first — delete all sim rows, then re-insert.
 *   - DETERMINISTIC: all attribute values derived from index; row ids are
 *     randomUUID() (fine — nothing references them by fixed value).
 *   - TAGGED: sim members use email pattern `sim-member-NNN@scale.local`.
 *     Cleanup targets ONLY rows matching `%@scale.local` — real members untouched.
 *   - SELF-VERIFYING: asserts ≥300 members + ≥300 contexts + 1:1 correspondence.
 *
 * Usage:
 *   docker exec acropolisos-app npx tsx scripts/seed-scale-community.ts
 */

import { randomUUID } from "node:crypto";
import { inArray, like, sql } from "drizzle-orm";
import { validateWidgetConfig, type CatalogKind } from "../lib/widgets/catalog";
import { loadOntology } from "../lib/ontology/load";
import { getRuntimeOntologyDir } from "../lib/setup/paths";
import { createDb } from "../lib/db/client";
import { member, member_context } from "../lib/db/schema.generated";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MEMBER_COUNT = 300;
const BATCH_SIZE = 100;

// Tier values cycling through the three valid options
const TIERS: Array<"basic" | "sustaining" | "lifetime"> = [
  "basic",
  "sustaining",
  "lifetime",
];

// Fixed base timestamps (deterministic across runs)
const BASE_STARTED_AT = "2023-01-01"; // date string for started_at (date column)
const CTX_CREATED_AT = new Date("2026-01-01T00:00:00Z");
const CTX_UPDATED_AT = new Date("2026-05-26T00:00:00Z");

// Rudimentary-KB widget presets — VALID governed catalog descriptors (every config
// conforms to WIDGET_CATALOG schemas: metric = {type, agg:"count", filter?}, data_table =
// {type, columns[min1], filter?:{field,value}}). Varied 5 ways by member index to
// represent different roles/interests. NOTE: these are validated fail-closed below.
const KB_PRESETS: ReadonlyArray<
  ReadonlyArray<{ id: string; kind: CatalogKind; config: unknown }>
> = [
  [{ id: "w-shift", kind: "metric", config: { type: "shift", agg: "count" } }],
  [{ id: "w-booking", kind: "data_table", config: { type: "booking", columns: ["label", "from_date", "to_date"] } }],
  [
    { id: "w-bed", kind: "data_table", config: { type: "bed", columns: ["code", "room", "out_of_service"] } },
    { id: "w-shift", kind: "metric", config: { type: "shift", agg: "count" } },
  ],
  [{ id: "w-guest", kind: "data_table", config: { type: "guest", columns: ["full_name", "country", "current_status"] } }],
  [
    { id: "w-blockers", kind: "metric", config: { type: "agent_blocker", agg: "count", filter: { field: "status", value: "open" } } },
    { id: "w-bed", kind: "data_table", config: { type: "bed", columns: ["code", "room"] } },
  ],
];

// FAIL-CLOSED: validate every preset against the governed catalog (membership +
// field whitelist now ONTOLOGY-DERIVED). A malformed KB descriptor aborts the
// seed rather than silently persisting a config that would be dropped on /me
// render. (Closes Via Negativa cycle-4 MED.) Async because validation reads the
// loaded ontology, so it runs inside main() rather than at module load.
async function assertPresetsValid(): Promise<void> {
  const ontology = await loadOntology(getRuntimeOntologyDir());
  for (const preset of KB_PRESETS) {
    for (const w of preset) {
      const r = validateWidgetConfig(w.kind, w.config, ontology);
      if (!r.ok) {
        throw new Error(`Invalid KB preset widget "${w.id}" (${w.kind}): ${JSON.stringify(r)}`);
      }
    }
  }
}

// Minimal widget descriptors for rudimentary KB — vary by member index.
function pinnedWidgetsFor(index: number): string {
  return JSON.stringify(KB_PRESETS[index % KB_PRESETS.length]);
}

// Zero-pad index to 3 digits
function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

// Derive a phone number deterministically from index
function phoneFor(index: number): string {
  return `+1-555-${String(index).padStart(4, "0")}`;
}

// Derive started_at date — spread members over the range 2023-01-01 to 2025-12-31
function startedAtFor(index: number): string {
  // ~300 members spread over ~3 years = 1095 days
  // index 1..300 maps to day offset 0..1094
  const dayOffset = Math.floor(((index - 1) / MEMBER_COUNT) * 1095);
  const d = new Date(BASE_STARTED_AT);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch helper: splits an array into chunks
// ─────────────────────────────────────────────────────────────────────────────
function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const db = createDb(DATABASE_URL);

  // FAIL-CLOSED preset validation (ontology-derived) before any DB writes.
  await assertPresetsValid();

  // ── STEP 1: Idempotent cleanup ──────────────────────────────────────────────
  console.log("\n=== CLEANUP (idempotent) ===");

  // Find existing sim member IDs (tagged by @scale.local email)
  const existingSimMembers = await db
    .select({ id: member.id })
    .from(member)
    .where(like(member.email, "%@scale.local"));

  const existingIds = existingSimMembers.map((m) => m.id);
  console.log(`  Found ${existingIds.length} existing sim member(s) to clean up`);

  if (existingIds.length > 0) {
    // Delete member_context rows FIRST (FK: member_context.member_id → member.id)
    // Process in batches to avoid huge IN() clauses
    let ctxDeleted = 0;
    for (const batch of chunks(existingIds, BATCH_SIZE)) {
      const deleted = await db
        .delete(member_context)
        .where(inArray(member_context.member_id, batch))
        .returning({ id: member_context.id });
      ctxDeleted += deleted.length;
    }
    console.log(`  Deleted ${ctxDeleted} member_context row(s)`);

    // Then delete the member rows
    let memberDeleted = 0;
    for (const batch of chunks(existingIds, BATCH_SIZE)) {
      const deleted = await db
        .delete(member)
        .where(inArray(member.id, batch))
        .returning({ id: member.id });
      memberDeleted += deleted.length;
    }
    console.log(`  Deleted ${memberDeleted} member row(s)`);
  } else {
    console.log("  Nothing to clean up");
  }

  // ── STEP 2: Build member rows ───────────────────────────────────────────────
  console.log("\n=== INSERT MEMBERS ===");

  type MemberInsert = {
    id: string;
    full_name: string;
    email: string;
    phone: string;
    tier_role: string;
    started_at: string;
    notes: string;
  };

  const memberRows: MemberInsert[] = [];
  for (let i = 1; i <= MEMBER_COUNT; i++) {
    const idx = pad3(i);
    memberRows.push({
      id: randomUUID(),
      full_name: `Sim Member ${idx}`,
      email: `sim-member-${idx}@scale.local`,
      phone: phoneFor(i),
      tier_role: TIERS[(i - 1) % TIERS.length],
      started_at: startedAtFor(i),
      notes: `Simulated community member ${idx} — M3 scale seed`,
    });
  }

  // Insert members in batches of BATCH_SIZE
  let insertedMembers = 0;
  for (const batch of chunks(memberRows, BATCH_SIZE)) {
    await db.insert(member).values(batch);
    insertedMembers += batch.length;
    console.log(`  Inserted members ${insertedMembers - batch.length + 1}..${insertedMembers}`);
  }
  console.log(`  Total members inserted: ${insertedMembers}`);

  // ── STEP 3: Build member_context rows ──────────────────────────────────────
  console.log("\n=== INSERT MEMBER CONTEXTS ===");

  type ContextInsert = {
    id: string;
    member_id: string;
    pinned_widgets: string;
    created_at: Date;
    updated_at: Date;
  };

  const contextRows: ContextInsert[] = memberRows.map((m, idx) => ({
    id: randomUUID(),
    member_id: m.id,
    pinned_widgets: pinnedWidgetsFor(idx + 1), // index 1-based
    created_at: CTX_CREATED_AT,
    updated_at: CTX_UPDATED_AT,
  }));

  let insertedContexts = 0;
  for (const batch of chunks(contextRows, BATCH_SIZE)) {
    await db.insert(member_context).values(batch);
    insertedContexts += batch.length;
    console.log(`  Inserted contexts ${insertedContexts - batch.length + 1}..${insertedContexts}`);
  }
  console.log(`  Total contexts inserted: ${insertedContexts}`);

  // ── STEP 4: Self-verify (acceptance) ───────────────────────────────────────
  console.log("\n=== SELF-VERIFY ===");

  // Count sim members
  const memberCountResult = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(member)
    .where(like(member.email, "%@scale.local"));
  const memberCount = memberCountResult[0]?.count ?? 0;

  // Count sim member_contexts (join to verify 1:1)
  const contextCountResult = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(member_context)
    .where(
      inArray(
        member_context.member_id,
        db.select({ id: member.id }).from(member).where(like(member.email, "%@scale.local"))
      )
    );
  const contextCount = contextCountResult[0]?.count ?? 0;

  console.log(`  Sim members in DB:  ${memberCount}`);
  console.log(`  Sim contexts in DB: ${contextCount}`);

  let passed = true;

  if (memberCount < 300) {
    console.error(`  FAIL: expected ≥300 members, got ${memberCount}`);
    passed = false;
  }

  if (contextCount < 300) {
    console.error(`  FAIL: expected ≥300 contexts, got ${contextCount}`);
    passed = false;
  }

  if (memberCount !== contextCount) {
    console.error(
      `  FAIL: 1:1 correspondence broken — ${memberCount} members vs ${contextCount} contexts`
    );
    passed = false;
  }

  if (!passed) {
    console.error("\nSCALE ACCEPTANCE FAIL");
    await (db.$client as { end: () => Promise<void> }).end();
    process.exit(1);
  }

  console.log(`\nSCALE ACCEPTANCE PASS: ${memberCount} members, ${contextCount} contexts`);

  await (db.$client as { end: () => Promise<void> }).end();
  process.exit(0);
}

main().catch((err) => {
  console.error("SEED FAILED:", err);
  process.exit(1);
});
