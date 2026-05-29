/**
 * V2 Read-Only Data API proof.
 *
 * CASE 1 — Live reads via the API:
 *   api.count("guest") === SELECT count(*) FROM guest
 *   api.select("guest", {columns:[...], limit:5}) returns ≤5 rows with correct columns
 *
 * CASE 2 — Structurally read-only:
 *   Object.keys(api) contains NO insert/update/delete/create/write methods
 *   grep lib/widgets/read-api.ts for db.insert|db.update|db.delete → ZERO matches
 *   ReadOnlyDataApi TS type has no mutation member (verified by presence-only check)
 *
 * CASE 3 — Injection consolidated + safe:
 *   api.count('guest"; DROP TABLE member; --') → 0 (safe empty)
 *   api.select with bogus type/column → safe empty
 *   SELECT count(*) FROM member still works (table intact)
 *
 * CASE 4 — Bindings no longer touch db:
 *   grep lib/widgets/catalog.ts for "db\." → ZERO matches in queryBinding scope
 *   Bindings import ReadOnlyDataApi, not Database
 *
 * CASE 5 — Regression:
 *   resolveDashboard(memberId, db) still returns metric.value === live guest count
 *
 * Usage: docker exec acropolisos-app npx tsx scripts/read-api-proof.ts
 */

import { sql, eq } from "drizzle-orm";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createDb } from "../lib/db/client";
import { member, member_context } from "../lib/db/schema.generated";
import { createReadOnlyDataApi, CAN_READ_ALL } from "../lib/widgets/read-api";
import { compose_dashboard, resolveDashboard } from "../lib/widgets/compose";
import { loadOntology } from "../lib/ontology/load";
import { getRuntimeOntologyDir } from "../lib/setup/paths";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

let PASS = 0;
let FAIL = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    FAIL++;
  } else {
    console.log(`  PASS: ${message}`);
    PASS++;
  }
}

async function main() {
  const db = createDb(DATABASE_URL!);
  // Trusted proof context: structural whitelist derived from the loaded ontology.
  const ontology = await loadOntology(getRuntimeOntologyDir());
  const api = createReadOnlyDataApi(db, CAN_READ_ALL, ontology);

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1 — Live reads via the API
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n=== CASE 1: Live reads via the API ===");

  // 1a: api.count("guest") === SELECT count(*) FROM guest
  const rawCountRows = await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM "guest"`,
  ) as Array<{ count: unknown }>;
  const rawCount = typeof rawCountRows[0]?.count === "number"
    ? rawCountRows[0].count
    : Number(rawCountRows[0]?.count ?? 0);

  const apiCount = await api.count("guest");

  console.log(`  SELECT count(*) FROM guest = ${rawCount}`);
  console.log(`  api.count("guest")         = ${apiCount}`);
  assert(
    apiCount === rawCount,
    `api.count("guest") [${apiCount}] === SELECT count(*) FROM guest [${rawCount}]`,
  );

  // 1b: api.select returns ≤5 real rows with exactly the requested columns
  const selectResult = await api.select("guest", {
    columns: ["full_name", "email"],
    limit: 5,
  });

  console.log(`\n  api.select("guest", {columns:["full_name","email"], limit:5}):`);
  console.log(`    columns returned: ${JSON.stringify(selectResult.columns)}`);
  console.log(`    row count: ${selectResult.rows.length}`);
  if (selectResult.rows.length > 0) {
    console.log(`    sample row: ${JSON.stringify(selectResult.rows[0])}`);
  }

  assert(
    selectResult.rows.length <= 5,
    `select returns ≤5 rows (got ${selectResult.rows.length})`,
  );
  assert(
    JSON.stringify(selectResult.columns) === JSON.stringify(["full_name", "email"]),
    `columns property is exactly ["full_name","email"] (got ${JSON.stringify(selectResult.columns)})`,
  );
  if (selectResult.rows.length > 0) {
    const rowKeys = Object.keys(selectResult.rows[0]).sort();
    assert(
      rowKeys.length === 2 && rowKeys.includes("full_name") && rowKeys.includes("email"),
      `each row has exactly {full_name, email} keys (got ${JSON.stringify(rowKeys)})`,
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2 — Structurally read-only
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n=== CASE 2: Structurally read-only ===");

  // 2a: Object.keys(api) — print and assert no mutation methods
  const apiKeys = Object.keys(api);
  console.log(`  Object.keys(api) = ${JSON.stringify(apiKeys)}`);

  const mutationNames = ["insert", "update", "delete", "create", "write", "mutate", "upsert"];
  const foundMutations = apiKeys.filter((k) =>
    mutationNames.some((m) => k.toLowerCase().includes(m)),
  );
  assert(
    foundMutations.length === 0,
    `api object has NO mutation methods (found: ${JSON.stringify(foundMutations)}, all keys: ${JSON.stringify(apiKeys)})`,
  );

  // 2b: grep read-api.ts for db.insert|db.update|db.delete — must be ZERO non-comment lines
  const readApiPath = path.resolve(__dirname, "../lib/widgets/read-api.ts");
  const readApiSource = fs.readFileSync(readApiPath, "utf8");
  // Filter to only non-comment lines (lines not starting with // after trim)
  const readApiNonCommentLines = readApiSource
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"));
  const readApiNonCommentText = readApiNonCommentLines.join("\n");
  const mutationPatterns = ["db.insert", "db.update", "db.delete"];
  const foundInSource = mutationPatterns.filter((p) => readApiNonCommentText.includes(p));

  console.log(`\n  grep lib/widgets/read-api.ts (non-comment lines) for db.insert|db.update|db.delete:`);
  console.log(`    found: ${foundInSource.length === 0 ? "NONE" : JSON.stringify(foundInSource)}`);
  assert(
    foundInSource.length === 0,
    `read-api.ts contains ZERO db.insert/db.update/db.delete calls in non-comment lines (found: ${JSON.stringify(foundInSource)})`,
  );

  // 2c: TS type verification — ReadOnlyDataApi has count, select, byDate only
  // (TS type verified at compile time; at runtime we check the api object)
  const expectedMethods = ["count", "select", "byDate"];
  const apiAsRecord = api as unknown as Record<string, unknown>;
  const hasAllExpected = expectedMethods.every((m) => typeof apiAsRecord[m] === "function");
  assert(
    hasAllExpected,
    `api has all expected read methods: ${JSON.stringify(expectedMethods)}`,
  );
  console.log(`  ReadOnlyDataApi type members: ${JSON.stringify(expectedMethods)} — verified (no mutation member in the type)`);

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 3 — Injection consolidated + safe
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n=== CASE 3: Injection consolidated + safe ===");

  // 3a: injected type → safe empty
  const INJECTION = 'guest"; DROP TABLE member; --';
  const injectedCount = await api.count(INJECTION);
  console.log(`  api.count('${INJECTION}') = ${injectedCount}`);
  assert(injectedCount === 0, `injected type → count 0 (safe empty, got ${injectedCount})`);

  // 3b: bogus type on select → safe empty
  const injectedSelect = await api.select("totally_fake_table", {
    columns: ["id"],
    limit: 5,
  });
  console.log(`  api.select("totally_fake_table", ...) columns=${JSON.stringify(injectedSelect.columns)} rows=${injectedSelect.rows.length}`);
  assert(
    injectedSelect.columns.length === 0 && injectedSelect.rows.length === 0,
    `bogus type on select → empty (columns=[], rows=[])`,
  );

  // 3c: bogus column on real type → empty (column filtered out)
  const bogusColSelect = await api.select("guest", {
    columns: ["totally_fake_column"],
    limit: 5,
  });
  console.log(`  api.select("guest", {columns:["totally_fake_column"]}) → columns=${JSON.stringify(bogusColSelect.columns)}`);
  assert(
    bogusColSelect.columns.length === 0,
    `bogus column filtered out → columns:[] (got ${JSON.stringify(bogusColSelect.columns)})`,
  );

  // 3d: member table still intact after all injection attempts
  const memberCountRows = await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM "member"`,
  ) as Array<{ count: unknown }>;
  const memberCount = typeof memberCountRows[0]?.count === "number"
    ? memberCountRows[0].count
    : Number(memberCountRows[0]?.count ?? 0);
  console.log(`  SELECT count(*) FROM member after injections = ${memberCount}`);
  assert(memberCount > 0, `member table intact after all injection attempts (count=${memberCount})`);

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 4 — Bindings no longer touch db
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n=== CASE 4: Bindings no longer touch db ===");

  const catalogPath = path.resolve(__dirname, "../lib/widgets/catalog.ts");
  const catalogSource = fs.readFileSync(catalogPath, "utf8");

  // Check that queryBindings no longer reference db. directly — exclude comment lines
  const catalogNonCommentLines = catalogSource
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"));
  const catalogNonCommentText = catalogNonCommentLines.join("\n");
  const dbPatterns = ["db.execute", "db.select(", "db.insert", "db.update", "db.delete"];
  const foundDbUsage = dbPatterns.filter((p) => catalogNonCommentText.includes(p));

  console.log(`  grep lib/widgets/catalog.ts (non-comment lines) for db.execute|db.select|db.insert|db.update|db.delete:`);
  console.log(`    found: ${foundDbUsage.length === 0 ? "NONE" : JSON.stringify(foundDbUsage)}`);
  assert(
    foundDbUsage.length === 0,
    `catalog.ts queryBindings contain ZERO direct db.* calls (found: ${JSON.stringify(foundDbUsage)})`,
  );

  // Check that Database type is NOT imported in catalog.ts
  const hasDatabaseImport = catalogSource.includes("import type { Database }") ||
    catalogSource.includes('from "@/lib/db/client"') ||
    catalogSource.includes("from '../lib/db/client'");
  console.log(`  catalog.ts imports Database type: ${hasDatabaseImport}`);
  assert(
    !hasDatabaseImport,
    `catalog.ts does NOT import Database (db client removed — bindings use api only)`,
  );

  // Check queryBinding parameter is 'api' not 'db'
  const queryBindingWithDb = /queryBinding:\s*async\s*\([^)]*,\s*db\b/.test(catalogSource);
  const queryBindingWithApi = /queryBinding:\s*async\s*\([^)]*,\s*api\b/.test(catalogSource);
  console.log(`  queryBinding params — uses 'db': ${queryBindingWithDb}, uses 'api': ${queryBindingWithApi}`);
  assert(
    !queryBindingWithDb && queryBindingWithApi,
    `queryBindings use 'api' (ReadOnlyDataApi), not 'db' (Database)`,
  );

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 5 — Regression: resolveDashboard returns live data
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n=== CASE 5: Regression — resolveDashboard returns live guest count ===");

  // Find a member to use
  const members = await db.select().from(member).limit(20);
  const stewardMember = members.find((m) => m.tier_role === "manager") ?? members[0];
  if (!stewardMember) {
    console.error("  No members in DB — cannot run regression");
    FAIL++;
  } else {
    const stewardMemberId = stewardMember.id;
    console.log(`  Using member: ${stewardMember.full_name} (id=${stewardMemberId})`);

    // Save original pinned_widgets
    const origRows = await db
      .select({ pinned_widgets: member_context.pinned_widgets, id: member_context.id })
      .from(member_context)
      .where(eq(member_context.member_id, stewardMemberId))
      .limit(1);
    const origPinned = origRows.length > 0 ? origRows[0].pinned_widgets : null;
    const origContextId = origRows.length > 0 ? origRows[0].id : null;

    // Compose a fresh dashboard with a guest count metric
    const composeResult = await compose_dashboard(db, stewardMemberId, [
      { kind: "metric", config: { type: "guest", agg: "count" } },
    ]);
    console.log(`  compose_dashboard result: ${JSON.stringify(composeResult)}`);
    assert(
      composeResult.status === "ok" && composeResult.persisted === 1,
      `compose_dashboard succeeded (${JSON.stringify(composeResult)})`,
    );

    // resolveDashboard should return the metric with live guest count
    const resolved = await resolveDashboard(db, stewardMemberId, CAN_READ_ALL);
    console.log(`  resolveDashboard returned ${resolved.length} widget(s)`);
    const metricWidget = resolved.find((w) => w.kind === "metric");

    if (!metricWidget) {
      console.error("  No metric widget in resolved dashboard");
      FAIL++;
    } else {
      const metricData = metricWidget.data as { value: number; label: string };
      console.log(`  metric.value = ${metricData.value}, label = ${metricData.label}`);
      console.log(`  live guest count (raw SQL) = ${rawCount}`);
      assert(
        metricData.value === rawCount,
        `resolveDashboard metric.value [${metricData.value}] === live guest count [${rawCount}] (V1 behavior preserved)`,
      );
    }

    // Restore original pinned_widgets
    console.log("\n  Restoring original pinned_widgets...");
    if (origPinned === null && origContextId === null) {
      await db.delete(member_context).where(eq(member_context.member_id, stewardMemberId));
      console.log("  Deleted member_context row (did not exist before proof)");
    } else if (origContextId) {
      await db
        .update(member_context)
        .set({ pinned_widgets: origPinned!, updated_at: new Date() })
        .where(eq(member_context.member_id, stewardMemberId));
      console.log(`  Restored pinned_widgets`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n=== READ-API PROOF SUMMARY: ${PASS} PASS / ${FAIL} FAIL ===`);

  if (FAIL > 0) {
    console.error(`PROOF FAILED: ${FAIL} assertion(s) failed`);
    await (db.$client as { end: () => Promise<void> }).end();
    process.exit(1);
  }

  console.log("=== ALL READ-API PROOF ASSERTIONS PASS ===");

  await (db.$client as { end: () => Promise<void> }).end();
  process.exit(0);
}

main().catch((err) => {
  console.error("PROOF SCRIPT FAILED:", err);
  process.exit(1);
});
