// V3 proof script: per-user ontological dashboard.
//
// Cases:
// 1. Two roles → different widgets from same function (same code, different cards)
// 2. Both render live data via the read-only api (widget value === live SQL count)
// 3. pinned_widgets override: explicit pinned > role default
// 4. Session-derived (code check): paste the relevant line
// 5. Cleanup

import { getDb } from "@/lib/db/client";
import { resolvePerUserDashboard, SLICE_SPEC } from "@/lib/widgets/per-user";
import { compose_dashboard } from "@/lib/widgets/compose";
import {
  member as memberTable,
  member_context as memberContextTable,
} from "@/lib/db/schema.generated";
import { eq, inArray, sql } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────

function pass(label: string) {
  console.log(`PASS | ${label}`);
}

function fail(label: string, detail?: unknown) {
  console.error(`FAIL | ${label}`, detail ?? "");
  process.exit(1);
}

function widgetSummary(widgets: Array<{ id: string; kind: string; config: unknown; data: unknown }>) {
  return widgets.map((w) => {
    const cfg = w.config as Record<string, unknown>;
    return `${w.kind}(type=${cfg.type ?? "?"})`;
  }).join(", ");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = getDb();

  // ── Baseline: live counts for assertion ──────────────────────────────────

  const [guestCountRow] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM "guest"`) as Array<{ count: unknown }>;
  const liveGuestCount = typeof guestCountRow.count === "number"
    ? guestCountRow.count
    : Number(guestCountRow.count ?? 0);

  const [memberCountRow] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM "member"`) as Array<{ count: unknown }>;
  const liveMemberCount = typeof memberCountRow.count === "number"
    ? memberCountRow.count
    : Number(memberCountRow.count ?? 0);

  console.log(`\nBaseline: guest=${liveGuestCount}, member=${liveMemberCount}`);

  // ── Get seed members ──────────────────────────────────────────────────────

  const allMembers = await db.select().from(memberTable);
  const managerMember = allMembers.find((m) => m.tier_role === "manager");
  const workTraderMember = allMembers.find((m) => m.tier_role === "work_trader");

  if (!managerMember || !workTraderMember) {
    fail("Could not find seed members with tier_role=manager and work_trader",
      { found: allMembers.map((m) => ({ name: m.full_name, tier_role: m.tier_role })) });
    return;
  }

  console.log(`\nManager member: ${managerMember.full_name} (${managerMember.id})`);
  console.log(`Work-trader member: ${workTraderMember.full_name} (${workTraderMember.id})`);

  // ── CASE 1: Two roles, different dashboards, SAME function ───────────────

  console.log("\n── CASE 1: Two roles → different widgets from SAME function ──");

  // Clear any existing pinned_widgets for clean test (so role default fires)
  // Save originals for cleanup
  const originalContexts: Array<{ id: string; member_id: string; pinned_widgets: string }> = [];
  for (const m of [managerMember, workTraderMember]) {
    const existing = await db
      .select()
      .from(memberContextTable)
      .where(eq(memberContextTable.member_id, m.id))
      .limit(1);
    if (existing.length > 0) {
      originalContexts.push({
        id: existing[0].id,
        member_id: m.id,
        pinned_widgets: existing[0].pinned_widgets,
      });
      // Clear pinned_widgets so role default fires
      await db
        .update(memberContextTable)
        .set({ pinned_widgets: "[]", updated_at: new Date() })
        .where(eq(memberContextTable.member_id, m.id));
    }
  }

  // Call SAME function with different members
  const managerWidgets = await resolvePerUserDashboard(db, {
    id: managerMember.id,
    tier_role: managerMember.tier_role,
  });

  const workTraderWidgets = await resolvePerUserDashboard(db, {
    id: workTraderMember.id,
    tier_role: workTraderMember.tier_role,
  });

  console.log(`\nManager (${managerMember.tier_role}) widgets:`);
  console.log(" ", widgetSummary(managerWidgets));
  console.log(`\nWork-trader (${workTraderMember.tier_role}) widgets:`);
  console.log(" ", widgetSummary(workTraderWidgets));

  if (managerWidgets.length === 0) {
    fail("CASE 1: manager got 0 widgets (should have SLICE_SPEC[manager] defaults)");
  }
  if (workTraderWidgets.length === 0) {
    fail("CASE 1: work_trader got 0 widgets (should have SLICE_SPEC[work_trader] defaults)");
  }

  // Assert they differ — different kinds or configs
  const managerSummary = widgetSummary(managerWidgets);
  const workTraderSummary = widgetSummary(workTraderWidgets);

  if (managerSummary === workTraderSummary) {
    fail("CASE 1: manager and work_trader got IDENTICAL widgets — not per-user", {
      manager: managerSummary,
      work_trader: workTraderSummary,
    });
  }

  pass(`CASE 1 — same function resolvePerUserDashboard, DIFFERENT cards:\n  manager(${managerMember.tier_role}): ${managerSummary}\n  work_trader(${workTraderMember.tier_role}): ${workTraderSummary}`);

  // ── CASE 2: Both render live data via the read-only api ───────────────────

  console.log("\n── CASE 2: Live data from read-only api ──");

  // Manager should have metric(guest) and metric(member)
  const managerGuestMetric = managerWidgets.find(
    (w) => w.kind === "metric" && (w.config as { type: string }).type === "guest"
  );
  const managerMemberMetric = managerWidgets.find(
    (w) => w.kind === "metric" && (w.config as { type: string }).type === "member"
  );

  if (!managerGuestMetric) {
    fail("CASE 2: manager missing metric(guest)");
  }
  if (!managerMemberMetric) {
    fail("CASE 2: manager missing metric(member)");
  }

  const guestMetricValue = (managerGuestMetric!.data as { value: number }).value;
  const memberMetricValue = (managerMemberMetric!.data as { value: number }).value;

  console.log(`Manager guest metric value: ${guestMetricValue} (live count: ${liveGuestCount})`);
  console.log(`Manager member metric value: ${memberMetricValue} (live count: ${liveMemberCount})`);

  if (guestMetricValue !== liveGuestCount) {
    fail(`CASE 2: manager guest metric ${guestMetricValue} !== live count ${liveGuestCount}`);
  }
  if (memberMetricValue !== liveMemberCount) {
    fail(`CASE 2: manager member metric ${memberMetricValue} !== live count ${liveMemberCount}`);
  }

  // Work-trader should have roster(shift) — check it resolved some data shape
  const wtRoster = workTraderWidgets.find((w) => w.kind === "roster");
  if (!wtRoster) {
    fail("CASE 2: work_trader missing roster widget");
  }
  const wtEntries = (wtRoster!.data as { entries: unknown[] }).entries;
  console.log(`Work-trader shift roster: ${wtEntries.length} entries`);

  pass(`CASE 2 — live data verified: guest metric=${guestMetricValue}==count ${liveGuestCount}, member metric=${memberMetricValue}==count ${liveMemberCount}, work_trader roster=${wtEntries.length} entries`);

  // ── CASE 3: pinned_widgets override ──────────────────────────────────────

  console.log("\n── CASE 3: explicit pinned_widgets override role default ──");

  // Pin a DIFFERENT set for the manager — supervisor's spec (narrower)
  const overrideSelections = SLICE_SPEC["supervisor"];
  const overrideSummary = overrideSelections.map((d) => {
    const cfg = d.config as Record<string, unknown>;
    return `${d.kind}(type=${cfg.type ?? "?"})`;
  }).join(", ");

  await compose_dashboard(db, managerMember.id, overrideSelections);

  const managerWithOverride = await resolvePerUserDashboard(db, {
    id: managerMember.id,
    tier_role: managerMember.tier_role,
  });

  const overrideResult = widgetSummary(managerWithOverride);
  console.log(`\nManager with pinned override (supervisor spec): ${overrideResult}`);
  console.log(`Manager role default was: ${managerSummary}`);

  // The override should differ from role default
  if (overrideResult === managerSummary) {
    fail("CASE 3: pinned_widgets override returned role default — override not respected");
  }

  // The override should match the supervisor spec we pinned
  if (overrideResult !== overrideSummary) {
    fail(`CASE 3: override result doesn't match pinned spec`, {
      got: overrideResult,
      expected: overrideSummary,
    });
  }

  pass(`CASE 3 — pinned_widgets override works: explicit '${overrideResult}' != role default '${managerSummary}'`);

  // ── CASE 4: Session-derived (code check) ─────────────────────────────────

  console.log("\n── CASE 4: Session-derived member/role ──");

  // Quote the exact line from app/page.tsx that shows session derivation
  const sessionDerivedLine = `
  // From app/page.tsx — the ONLY source of actor is buildChatRuntime():
  const chatRuntime = await buildChatRuntime();   // ← session
  const actor = chatRuntime.actor!;               // ← session actor
  // Then:
  .where(eq(memberTable.id, actor.userId))        // ← actor.userId from session, never a param
  // Then passed to:
  widgets = await resolvePerUserDashboard(db, { id: me.id, tier_role: me.tier_role });
  // resolvePerUserDashboard signature: (db, member: { id: string; tier_role: string })
  // — no role/memberId params passed in from request body or URL.
  `;

  console.log(sessionDerivedLine);
  pass("CASE 4 — member/role from buildChatRuntime() session, not a request param (see line above)");

  // ── CASE 6: all-invalid pinned → role-default floor ──────────────────────

  console.log("\n── CASE 6: all-invalid pinned_widgets → role-default floor ──");

  // Set manager's pinned_widgets to a parseable but ALL-INVALID config
  // (references a nonexistent column — validateWidgetConfig will reject it)
  const allInvalidPinned = JSON.stringify([
    { id: "x", kind: "data_table", config: { type: "guest", columns: ["nonexistent_col"], limit: 10 } },
  ]);

  // Ensure manager has a member_context row to update (create if missing)
  const managerCtxRow = await db
    .select()
    .from(memberContextTable)
    .where(eq(memberContextTable.member_id, managerMember.id))
    .limit(1);

  if (managerCtxRow.length === 0) {
    // Insert a fresh context row with the all-invalid pinned config
    await db.insert(memberContextTable).values({
      member_id: managerMember.id,
      pinned_widgets: allInvalidPinned,
      created_at: new Date(),
      updated_at: new Date(),
    });
  } else {
    await db
      .update(memberContextTable)
      .set({ pinned_widgets: allInvalidPinned, updated_at: new Date() })
      .where(eq(memberContextTable.member_id, managerMember.id));
  }

  const managerAllInvalidWidgets = await resolvePerUserDashboard(db, {
    id: managerMember.id,
    tier_role: managerMember.tier_role,
  });

  console.log(`\nManager with all-invalid pinned_widgets:`);
  console.log("  resolved:", widgetSummary(managerAllInvalidWidgets));
  console.log("  expected (manager default):", managerSummary);

  if (managerAllInvalidWidgets.length === 0) {
    fail("CASE 6: all-invalid pinned returned [] — did NOT fall back to role default");
  }

  const case6Summary = widgetSummary(managerAllInvalidWidgets);
  if (case6Summary !== managerSummary) {
    fail(`CASE 6: fell back but not to manager SLICE_SPEC`, {
      got: case6Summary,
      expected: managerSummary,
    });
  }

  pass(`CASE 6 — all-invalid pinned falls back to role default: resolved == manager SLICE_SPEC '${case6Summary}'`);

  // ── CASE 7: partial-invalid pinned → keep valid only, no fallback ─────────

  console.log("\n── CASE 7: partial-invalid pinned → keep valid only, no fallback ──");

  // One VALID descriptor + one INVALID descriptor
  const partialInvalidPinned = JSON.stringify([
    // Valid: metric(guest, count) — this IS in WIDGET_CATALOG and valid config
    { id: "valid-1", kind: "metric", config: { type: "guest", agg: "count" } },
    // Invalid: data_table with nonexistent column — validateWidgetConfig rejects it
    { id: "invalid-1", kind: "data_table", config: { type: "guest", columns: ["nonexistent_col"], limit: 10 } },
  ]);

  await db
    .update(memberContextTable)
    .set({ pinned_widgets: partialInvalidPinned, updated_at: new Date() })
    .where(eq(memberContextTable.member_id, managerMember.id));

  const managerPartialWidgets = await resolvePerUserDashboard(db, {
    id: managerMember.id,
    tier_role: managerMember.tier_role,
  });

  console.log(`\nManager with partial-invalid pinned_widgets (1 valid + 1 invalid):`);
  console.log("  resolved:", widgetSummary(managerPartialWidgets));
  console.log("  manager SLICE_SPEC default:", managerSummary);

  if (managerPartialWidgets.length === 0) {
    fail("CASE 7: partial-invalid returned [] — should have kept the valid widget");
  }

  // Must return ONLY the valid one (the metric) — NOT fall back to full role default
  if (managerPartialWidgets.length !== 1) {
    fail(`CASE 7: expected exactly 1 valid widget (metric), got ${managerPartialWidgets.length}`, {
      widgets: widgetSummary(managerPartialWidgets),
    });
  }

  const validWidget = managerPartialWidgets[0];
  if (validWidget.kind !== "metric" || (validWidget.config as { type: string }).type !== "guest") {
    fail("CASE 7: surviving widget is not the expected metric(guest)", {
      got: validWidget,
    });
  }

  // Must NOT equal the full role default (that would mean it fell back)
  const case7Summary = widgetSummary(managerPartialWidgets);
  if (case7Summary === managerSummary) {
    fail("CASE 7: result matches full role default — incorrectly fell back instead of keeping valid widget");
  }

  pass(`CASE 7 — partial-invalid: only valid widget survives '${case7Summary}', no fallback to role default '${managerSummary}'`);

  // ── CASE 5: Cleanup ───────────────────────────────────────────────────────

  console.log("\n── CASE 5: Cleanup ──");

  // Restore original pinned_widgets
  for (const orig of originalContexts) {
    await db
      .update(memberContextTable)
      .set({ pinned_widgets: orig.pinned_widgets, updated_at: new Date() })
      .where(eq(memberContextTable.member_id, orig.member_id));
  }

  // Remove any member_context rows that didn't exist before the test
  // (for members that had no context row, we may have created one via compose_dashboard)
  const originalMemberIds = new Set(originalContexts.map((o) => o.member_id));
  for (const m of [managerMember, workTraderMember]) {
    if (!originalMemberIds.has(m.id)) {
      // This member had no context before — remove the one we created
      await db
        .delete(memberContextTable)
        .where(eq(memberContextTable.member_id, m.id));
    }
  }

  // Also clean up the manager context if we created it fresh for CASE 6/7
  // (if it wasn't in originalContexts it means it didn't exist before)
  if (!originalMemberIds.has(managerMember.id)) {
    await db
      .delete(memberContextTable)
      .where(eq(memberContextTable.member_id, managerMember.id));
  }

  console.log("cleanup done");
  pass("CASE 5 — cleanup done");

  console.log("\n── ALL CASES PASSED ─────────────────────────────────────────");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("PROOF SCRIPT ERROR:", err);
    process.exit(1);
  });
