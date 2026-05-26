/**
 * V1 widget catalog proof script.
 *
 * Tests:
 *   1. Compose: compose_dashboard persists 2 descriptors to member_context.pinned_widgets.
 *   2. Resolve = live data: resolveDashboard returns metric.value == SELECT count(*) FROM guest;
 *      data_table returns ≤5 real rows with the configured columns.
 *   3. Config-driven, not hardcoded: re-compose with {type:"member", agg:"count"} →
 *      resolve returns a DIFFERENT value == SELECT count(*) FROM member.
 *   4. Invalid config rejected: compose with {type:"nonexistent_type",...} → structured error,
 *      nothing persisted.
 *   5. Read-only fence: state how the catalog enforces read-only; grep catalog.ts for
 *      insert/update/delete — must be absent.
 *   6. Restore: restore the steward's original pinned_widgets.
 *
 * Usage: docker exec acropolisos-app npx tsx scripts/widget-proof.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { member_context, member } from "../lib/db/schema.generated";
import { compose_dashboard, resolveDashboard } from "../lib/widgets/compose";
import { CAN_READ_ALL } from "../lib/widgets/read-api";

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

async function main() {
  const db = createDb(DATABASE_URL!);

  // ── Find steward member (manager tier) ──────────────────────────────────────
  console.log("\n=== SETUP: Find steward/manager member ===");
  const members = await db.select().from(member).limit(20);
  const stewardMember =
    members.find((m) => m.tier_role === "manager") ?? members[0];
  if (!stewardMember) {
    console.error("No members found in DB");
    process.exit(1);
  }
  const stewardMemberId = stewardMember.id;
  console.log(
    `  Using member: ${stewardMember.full_name} (${stewardMember.email}) id=${stewardMemberId}`,
  );

  // ── Save original pinned_widgets ─────────────────────────────────────────────
  console.log("\n=== SETUP: Save original pinned_widgets ===");
  const originalRows = await db
    .select({ pinned_widgets: member_context.pinned_widgets, id: member_context.id })
    .from(member_context)
    .where(eq(member_context.member_id, stewardMemberId))
    .limit(1);
  const originalPinnedWidgets =
    originalRows.length > 0 ? originalRows[0].pinned_widgets : null;
  const originalContextId = originalRows.length > 0 ? originalRows[0].id : null;
  console.log(
    `  Original pinned_widgets: ${
      originalPinnedWidgets
        ? originalPinnedWidgets.slice(0, 80) + "..."
        : "(none — row does not exist)"
    }`,
  );

  // ── Get live counts for comparison ───────────────────────────────────────────
  console.log("\n=== SETUP: Get live counts ===");
  const guestCountRaw = await db.execute(sql`SELECT COUNT(*)::int AS count FROM "guest"`) as unknown as Array<{ count: unknown }>;
  const memberCountRaw = await db.execute(sql`SELECT COUNT(*)::int AS count FROM "member"`) as unknown as Array<{ count: unknown }>;

  const guestCount = Number(guestCountRaw[0]?.count ?? 0);
  const memberCount = Number(memberCountRaw[0]?.count ?? 0);
  console.log(`  SELECT count(*) FROM guest = ${guestCount}`);
  console.log(`  SELECT count(*) FROM member = ${memberCount}`);
  assert(guestCount !== memberCount, "guest count != member count (required for config-driven proof)");

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 1: Compose
  // ════════════════════════════════════════════════════════════════════════════

  console.log("\n=== TEST 1: compose_dashboard ===");

  const selections = [
    { kind: "metric" as const, config: { type: "guest", agg: "count" } },
    {
      kind: "data_table" as const,
      config: { type: "guest", columns: ["full_name", "email"], limit: 5 },
    },
  ];

  const composeResult = await compose_dashboard(db, stewardMemberId, selections);
  console.log("  compose_dashboard result:", JSON.stringify(composeResult));

  assert(
    composeResult.status === "ok",
    `compose_dashboard returned status ok (got: ${composeResult.status})`,
  );
  assert(
    composeResult.status === "ok" && composeResult.persisted === 2,
    `persisted count === 2 (got: ${
      composeResult.status === "ok" ? composeResult.persisted : "N/A"
    })`,
  );

  // Verify the DB column actually has the 2 descriptors
  const afterCompose = await db
    .select({ pinned_widgets: member_context.pinned_widgets })
    .from(member_context)
    .where(eq(member_context.member_id, stewardMemberId))
    .limit(1);

  assert(afterCompose.length === 1, "member_context row exists after compose");

  const stored = JSON.parse(afterCompose[0].pinned_widgets) as Array<{
    kind: string;
    config: unknown;
  }>;
  console.log("  Stored descriptors (raw JSON):");
  console.log(JSON.stringify(stored, null, 2));

  assert(
    Array.isArray(stored) && stored.length === 2,
    `stored.length === 2 (got: ${stored.length})`,
  );
  assert(
    stored[0].kind === "metric",
    `stored[0].kind === 'metric' (got: ${stored[0].kind})`,
  );
  assert(
    stored[1].kind === "data_table",
    `stored[1].kind === 'data_table' (got: ${stored[1].kind})`,
  );

  console.log("\nTEST 1 (compose persisted) — PASS");

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 2: Resolve = live data, config-driven
  // ════════════════════════════════════════════════════════════════════════════

  console.log("\n=== TEST 2: resolveDashboard (live data) ===");

  const resolved = await resolveDashboard(db, stewardMemberId, CAN_READ_ALL);
  console.log("\n  Resolved bundle:");
  console.log(JSON.stringify(resolved, null, 2));

  assert(resolved.length === 2, `resolved.length === 2 (got: ${resolved.length})`);

  const metricWidget = resolved.find((w) => w.kind === "metric");
  const tableWidget = resolved.find((w) => w.kind === "data_table");

  assert(metricWidget !== undefined, "metric widget present in resolved bundle");
  assert(tableWidget !== undefined, "data_table widget present in resolved bundle");

  const metricData = metricWidget?.data as
    | { value: number; label: string }
    | undefined;
  const tableData = tableWidget?.data as
    | { columns: string[]; rows: Record<string, unknown>[] }
    | undefined;

  console.log(
    `\n  metric.value = ${metricData?.value}  |  SELECT count(*) FROM guest = ${guestCount}`,
  );
  assert(
    metricData?.value === guestCount,
    `metric.value (${metricData?.value}) === live guest count (${guestCount})`,
  );

  const tableRows = tableData?.rows ?? [];
  console.log(`  data_table rows returned: ${tableRows.length} (limit was 5)`);
  assert(tableRows.length <= 5, `data_table rows <= 5 (got: ${tableRows.length})`);

  if (tableRows.length > 0) {
    const firstRowKeys = Object.keys(tableRows[0]);
    console.log(`  data_table first row keys: ${firstRowKeys.join(", ")}`);
    assert(
      firstRowKeys.includes("full_name"),
      "data_table rows contain 'full_name' column",
    );
    assert(
      firstRowKeys.includes("email"),
      "data_table rows contain 'email' column",
    );
    assert(
      !firstRowKeys.includes("phone"),
      "data_table rows do NOT contain 'phone' (not requested)",
    );
  }

  console.log("\nTEST 2 (resolve == live data, config-driven) — PASS");

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 3: Config-driven, not hardcoded — re-compose with member count
  // ════════════════════════════════════════════════════════════════════════════

  console.log("\n=== TEST 3: Re-compose with {type:'member', agg:'count'} ===");

  const recomposeResult = await compose_dashboard(db, stewardMemberId, [
    { kind: "metric" as const, config: { type: "member", agg: "count" } },
  ]);
  assert(
    recomposeResult.status === "ok",
    `re-compose status ok (got: ${recomposeResult.status})`,
  );

  const resolved2 = await resolveDashboard(db, stewardMemberId, CAN_READ_ALL);
  const metricWidget2 = resolved2.find((w) => w.kind === "metric");
  const metricData2 = metricWidget2?.data as
    | { value: number; label: string }
    | undefined;

  console.log(
    `  metric.value (member count) = ${metricData2?.value}  |  SELECT count(*) FROM member = ${memberCount}`,
  );
  assert(
    metricData2?.value === memberCount,
    `re-configured metric.value (${metricData2?.value}) === live member count (${memberCount})`,
  );
  assert(
    metricData2?.value !== guestCount,
    `member count (${metricData2?.value}) !== guest count (${guestCount}) — proves config-driven not hardcoded`,
  );

  console.log("\nTEST 3 (config-driven, not hardcoded) — PASS");

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 4: Invalid config rejected
  // ════════════════════════════════════════════════════════════════════════════

  console.log("\n=== TEST 4: Invalid config rejected ===");

  // 4a: nonexistent type
  const badResult1 = await compose_dashboard(db, stewardMemberId, [
    {
      kind: "metric" as const,
      config: { type: "nonexistent_type", agg: "count" },
    },
  ]);
  console.log("  Bad type result:", JSON.stringify(badResult1));
  assert(
    badResult1.status === "validation_error",
    `nonexistent type → validation_error (got: ${badResult1.status})`,
  );

  // Verify nothing was persisted (should still have member metric from test 3)
  const afterBad1 = await db
    .select({ pinned_widgets: member_context.pinned_widgets })
    .from(member_context)
    .where(eq(member_context.member_id, stewardMemberId))
    .limit(1);
  const afterBadDescriptors = JSON.parse(
    afterBad1[0].pinned_widgets,
  ) as Array<{ kind: string; config: Record<string, unknown> }>;
  assert(
    afterBadDescriptors.length === 1 &&
      afterBadDescriptors[0].config.type === "member",
    "pinned_widgets unchanged after invalid compose (still has member metric from test 3)",
  );

  // 4b: unknown column in data_table
  const badResult2 = await compose_dashboard(db, stewardMemberId, [
    {
      kind: "data_table" as const,
      config: {
        type: "guest",
        columns: ["full_name", "nonexistent_column"],
        limit: 5,
      },
    },
  ]);
  console.log("  Bad column result:", JSON.stringify(badResult2));
  assert(
    badResult2.status === "validation_error",
    `unknown column → validation_error (got: ${badResult2.status})`,
  );

  console.log("\nTEST 4 (invalid config rejected, not persisted) — PASS");

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 5: Read-only fence
  // ════════════════════════════════════════════════════════════════════════════

  console.log("\n=== TEST 5: Read-only fence ===");
  console.log("  Enforcement mechanism:");
  console.log("  - All queryBinding functions in lib/widgets/catalog.ts call only");
  console.log("    db.select() or db.execute(sql`SELECT ...`) — zero mutations.");
  console.log("  - ARCHITECTURE §2/§7 enforced by construction: the catalog module");
  console.log("    has no drizzle insert/update/delete imports or calls.");
  console.log("  - Scanning catalog.ts source for mutation calls...");

  const catalogSrc = readFileSync(
    path.join(process.cwd(), "lib/widgets/catalog.ts"),
    "utf8",
  );

  // Check for drizzle mutation method calls
  const mutationMethodMatches = [
    ...catalogSrc.matchAll(/\bdb\.(insert|update|delete)\b/g),
  ];
  console.log(
    `  db.insert/update/delete calls in catalog.ts: ${mutationMethodMatches.length}`,
  );
  assert(
    mutationMethodMatches.length === 0,
    `catalog.ts has ZERO db.insert/db.update/db.delete calls (found: ${mutationMethodMatches.length})`,
  );

  // Check for raw SQL mutations (exclude comment lines)
  const lines = catalogSrc.split("\n");
  const rawMutationLines = lines.filter(
    (line) =>
      !line.trimStart().startsWith("//") &&
      /\b(INSERT INTO|UPDATE\s+\w|DELETE FROM)\b/i.test(line),
  );
  console.log(
    `  Raw INSERT/UPDATE/DELETE SQL lines in catalog.ts: ${rawMutationLines.length}`,
  );
  assert(
    rawMutationLines.length === 0,
    `catalog.ts has ZERO raw mutation SQL lines (found: ${rawMutationLines.length})`,
  );

  console.log("\nTEST 5 (read-only fence confirmed) — PASS");

  // ════════════════════════════════════════════════════════════════════════════
  // RESTORE: steward's original pinned_widgets
  // ════════════════════════════════════════════════════════════════════════════

  console.log("\n=== RESTORE: original pinned_widgets ===");

  if (originalPinnedWidgets === null && originalContextId === null) {
    // No row existed before — delete the row we created
    await db
      .delete(member_context)
      .where(eq(member_context.member_id, stewardMemberId));
    console.log(
      "  Deleted member_context row (did not exist before proof)",
    );
  } else if (originalContextId) {
    // Row existed — restore the original pinned_widgets value
    await db
      .update(member_context)
      .set({ pinned_widgets: originalPinnedWidgets!, updated_at: new Date() })
      .where(eq(member_context.member_id, stewardMemberId));
    console.log(
      `  Restored pinned_widgets to: ${originalPinnedWidgets?.slice(0, 80)}...`,
    );
  }

  console.log("restored");

  console.log("\n=== V1 WIDGET CATALOG PROOF COMPLETE (ALL TESTS PASS) ===");

  await (db.$client as { end: () => Promise<void> }).end();
  process.exit(0);
}

main().catch((err) => {
  console.error("PROOF FAILED:", err);
  process.exit(1);
});
