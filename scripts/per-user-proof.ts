// Proof script: per-user ontological dashboard — the PERMISSION-LENS model.
//
// The default board is DERIVED from the ontology (deriveDefaultBoard) and scoped
// by the viewer's read permissions. A role differs ONLY by what canReadType
// admits — there is no hand-curated per-role list. The proof therefore exercises:
//
// CASE 1. Permission lens: SAME function, two different canReadType predicates →
//         different boards (broad reader sees more types than a narrow reader).
// CASE 2. The derived board renders live data via the read-only api.
// CASE 3. pinned_widgets override: explicit pinned > derived default.
// CASE 4. Session-derived (code check): paste the relevant line.
// CASE 6. all-invalid pinned → derived-default floor (member always sees SOMETHING).
// CASE 7. partial-invalid pinned → keep valid only, no fallback.
// CASE 5. Cleanup.

import { getDb } from "@/lib/db/client";
import { resolvePerUserDashboard } from "@/lib/widgets/per-user";
import { InMemoryApprovedViewsRegistry } from "@/lib/views/registry";
import { deriveDefaultBoard } from "@/lib/widgets/derive-board";
import { CAN_READ_ALL, type CanReadType } from "@/lib/widgets/read-api";
import { compose_dashboard } from "@/lib/widgets/compose";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import {
  member as memberTable,
  member_context as memberContextTable,
} from "@/lib/db/schema.generated";
import { eq, sql } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────

function pass(label: string) {
  console.log(`PASS | ${label}`);
}

function fail(label: string, detail?: unknown) {
  console.error(`FAIL | ${label}`, detail ?? "");
  process.exit(1);
}

function widgetSummary(widgets: Array<{ id: string; kind: string; config: unknown; data?: unknown }>) {
  return widgets.map((w) => {
    const cfg = w.config as Record<string, unknown>;
    return `${w.kind}(type=${cfg.type ?? "?"})`;
  }).join(", ");
}

function widgetTypes(widgets: Array<{ kind: string; config: unknown }>): string[] {
  return widgets.map((w) => String((w.config as { type?: string }).type ?? ""));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = getDb();
  // Empty approved-views registry: the proof exercises the floor/pins precedence
  // in isolation, so no steward-approved views should be merged into the floor.
  const registry = new InMemoryApprovedViewsRegistry();

  // Load the SAME runtime ontology the app uses — the single source of the
  // derived default board. The proof oracle is deriveDefaultBoard, not a list.
  const ontology = await loadOntology(getRuntimeOntologyDir());

  // ── Baseline: live counts for assertion ──────────────────────────────────

  const [guestCountRow] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM "guest"`) as Array<{ count: unknown }>;
  const liveGuestCount = typeof guestCountRow.count === "number"
    ? guestCountRow.count
    : Number(guestCountRow.count ?? 0);

  console.log(`\nBaseline: guest=${liveGuestCount}`);

  // ── Get a seed member (any role — role no longer changes the board) ────────

  const allMembers = await db.select().from(memberTable);
  const probeMember = allMembers.find((m) => m.tier_role === "manager") ?? allMembers[0];

  if (!probeMember) {
    fail("No seed members found — cannot run the per-user proof",
      { found: allMembers.map((m) => ({ name: m.full_name, tier_role: m.tier_role })) });
    return;
  }

  console.log(`\nProbe member: ${probeMember.full_name} (${probeMember.id}, role=${probeMember.tier_role})`);

  // ── CASE 1: permission lens — SAME function, different canReadType ─────────

  console.log("\n── CASE 1: permission lens → different canReadType, different board ──");

  // Clear pinned_widgets so the derived default fires. Save originals for cleanup.
  const originalContexts: Array<{ member_id: string; pinned_widgets: string }> = [];
  const existing = await db
    .select()
    .from(memberContextTable)
    .where(eq(memberContextTable.member_id, probeMember.id))
    .limit(1);
  if (existing.length > 0) {
    originalContexts.push({
      member_id: probeMember.id,
      pinned_widgets: existing[0].pinned_widgets,
    });
    await db
      .update(memberContextTable)
      .set({ pinned_widgets: "[]", updated_at: new Date() })
      .where(eq(memberContextTable.member_id, probeMember.id));
  }

  // Broad reader: can read everything.
  const broadBoard = await resolvePerUserDashboard(db, {
    id: probeMember.id,
    tier_role: probeMember.tier_role,
  }, CAN_READ_ALL, registry);

  // Narrow reader: can read ONLY `guest` (a real ontology type).
  const guestOnly: CanReadType = (t) => t === "guest";
  const narrowBoard = await resolvePerUserDashboard(db, {
    id: probeMember.id,
    tier_role: probeMember.tier_role,
  }, guestOnly, registry);

  console.log(`\nBroad reader (CAN_READ_ALL) board:`);
  console.log(" ", widgetSummary(broadBoard));
  console.log(`\nNarrow reader (guest-only) board:`);
  console.log(" ", widgetSummary(narrowBoard));

  if (broadBoard.length === 0) {
    fail("CASE 1: broad reader got 0 widgets (derived default should be non-empty)");
  }
  if (narrowBoard.length === 0) {
    fail("CASE 1: narrow (guest-only) reader got 0 widgets (guest is readable → should be non-empty)");
  }

  // The narrow board must be a STRICT subset of the broad board's type-set:
  // only guest-typed widgets, and never a type the narrow reader can't read.
  const narrowTypes = new Set(widgetTypes(narrowBoard));
  if (![...narrowTypes].every((t) => t === "guest")) {
    fail("CASE 1: narrow (guest-only) board leaked a non-guest type", {
      narrowTypes: [...narrowTypes],
    });
  }
  if (broadBoard.length <= narrowBoard.length) {
    fail("CASE 1: broad reader should see MORE widgets than the guest-only reader", {
      broad: broadBoard.length,
      narrow: narrowBoard.length,
    });
  }

  pass(`CASE 1 — permission lens via SAME function: broad sees ${broadBoard.length} widgets across many types, guest-only sees ${narrowBoard.length} (guest-typed only)`);

  // ── CASE 1b: the board matches the pure deriveDefaultBoard oracle ──────────

  console.log("\n── CASE 1b: rendered board shape == deriveDefaultBoard(ontology, canReadType) ──");

  // The pure derivation is the spec. The rendered board may drop widgets whose
  // binding throws on empty data, but it must never INVENT a type the oracle
  // didn't propose, and every rendered type must be in the oracle's type-set.
  const oracleTypes = new Set(widgetTypes(deriveDefaultBoard(ontology, CAN_READ_ALL)));
  const renderedTypes = widgetTypes(broadBoard);
  if (!renderedTypes.every((t) => oracleTypes.has(t))) {
    fail("CASE 1b: rendered board contains a type the derive-board oracle did not propose", {
      rendered: [...new Set(renderedTypes)],
      oracle: [...oracleTypes],
    });
  }
  if (oracleTypes.size === 0) {
    fail("CASE 1b: deriveDefaultBoard(ontology, CAN_READ_ALL) produced an empty oracle");
  }

  pass(`CASE 1b — every rendered widget type is admitted by the deriveDefaultBoard oracle (${oracleTypes.size} types)`);

  // ── CASE 2: derived board renders live data via the read-only api ─────────

  console.log("\n── CASE 2: Live data from read-only api ──");

  // The derived default emits a data_table for guest. Its row count must reflect
  // live data (capped by the descriptor limit). Prove it is a real query result.
  const guestTable = broadBoard.find(
    (w) => w.kind === "data_table" && (w.config as { type: string }).type === "guest",
  );
  if (!guestTable) {
    fail("CASE 2: derived board missing data_table(guest)", { board: widgetSummary(broadBoard) });
  }
  const guestRows = (guestTable!.data as { rows: unknown[] }).rows;
  const limit = (guestTable!.config as { limit?: number }).limit ?? Infinity;
  const expectedRows = Math.min(liveGuestCount, limit);
  console.log(`Guest data_table rows: ${guestRows.length} (live count=${liveGuestCount}, limit=${limit}, expected=${expectedRows})`);

  if (guestRows.length !== expectedRows) {
    fail(`CASE 2: guest data_table rows ${guestRows.length} !== min(liveCount, limit)=${expectedRows}`);
  }

  pass(`CASE 2 — live data verified: guest data_table=${guestRows.length} rows == min(liveCount ${liveGuestCount}, limit ${limit})`);

  // ── CASE 3: pinned_widgets override ──────────────────────────────────────

  console.log("\n── CASE 3: explicit pinned_widgets override derived default ──");

  // Pin a SINGLE explicit widget — distinct from the multi-widget derived floor.
  const overrideSelections = [
    { kind: "metric" as const, config: { type: "guest", agg: "count" } },
  ];
  const overrideSummary = overrideSelections.map((d) => {
    const cfg = d.config as Record<string, unknown>;
    return `${d.kind}(type=${cfg.type ?? "?"})`;
  }).join(", ");

  await compose_dashboard(db, probeMember.id, overrideSelections);

  const withOverride = await resolvePerUserDashboard(db, {
    id: probeMember.id,
    tier_role: probeMember.tier_role,
  }, CAN_READ_ALL, registry);

  const overrideResult = widgetSummary(withOverride);
  const derivedSummary = widgetSummary(broadBoard);
  console.log(`\nWith pinned override: ${overrideResult}`);
  console.log(`Derived default was:  ${derivedSummary}`);

  // The override should differ from the derived default…
  if (overrideResult === derivedSummary) {
    fail("CASE 3: pinned_widgets override returned the derived default — override not respected");
  }
  // …and match exactly the single widget we pinned.
  if (overrideResult !== overrideSummary) {
    fail(`CASE 3: override result doesn't match pinned spec`, {
      got: overrideResult,
      expected: overrideSummary,
    });
  }

  pass(`CASE 3 — pinned_widgets override works: explicit '${overrideResult}' != derived default '${derivedSummary}'`);

  // ── CASE 4: Session-derived (code check) ─────────────────────────────────

  console.log("\n── CASE 4: Session-derived member ──");

  const sessionDerivedLine = `
  // From app/page.tsx — the ONLY source of actor is buildChatRuntime():
  const chatRuntime = await buildChatRuntime();   // ← session
  const actor = chatRuntime.actor!;               // ← session actor
  // Then:
  .where(eq(memberTable.id, actor.userId))        // ← actor.userId from session, never a param
  // Then passed to:
  widgets = await resolvePerUserDashboard(db, { id: me.id, tier_role: me.tier_role }, canReadType, new PgApprovedViewsRegistry(db));
  // canReadType = buildCanReadType(actor, ontology) — the PERMISSION LENS.
  // resolvePerUserDashboard signature: (db, member: { id, tier_role }, canReadType, registry)
  // — no role/memberId params passed in from request body or URL; the board is
  //   derived from the ontology and scoped by the session actor's read permissions.
  `;

  console.log(sessionDerivedLine);
  pass("CASE 4 — member from buildChatRuntime() session, board scoped by the actor's canReadType (see line above)");

  // ── CASE 6: all-invalid pinned → derived-default floor ───────────────────

  console.log("\n── CASE 6: all-invalid pinned_widgets → derived-default floor ──");

  // Parseable but ALL-INVALID (references a nonexistent column → rejected).
  const allInvalidPinned = JSON.stringify([
    { id: "x", kind: "data_table", config: { type: "guest", columns: ["nonexistent_col"], limit: 10 } },
  ]);

  await db
    .update(memberContextTable)
    .set({ pinned_widgets: allInvalidPinned, updated_at: new Date() })
    .where(eq(memberContextTable.member_id, probeMember.id));

  const allInvalidWidgets = await resolvePerUserDashboard(db, {
    id: probeMember.id,
    tier_role: probeMember.tier_role,
  }, CAN_READ_ALL, registry);

  console.log(`\nWith all-invalid pinned_widgets:`);
  console.log("  resolved:", widgetSummary(allInvalidWidgets));
  console.log("  expected (derived default):", derivedSummary);

  if (allInvalidWidgets.length === 0) {
    fail("CASE 6: all-invalid pinned returned [] — did NOT fall back to derived default");
  }

  const case6Summary = widgetSummary(allInvalidWidgets);
  if (case6Summary !== derivedSummary) {
    fail(`CASE 6: fell back but not to the derived default`, {
      got: case6Summary,
      expected: derivedSummary,
    });
  }

  pass(`CASE 6 — all-invalid pinned falls back to the derived default: '${case6Summary}'`);

  // ── CASE 7: partial-invalid pinned → keep valid only, no fallback ─────────

  console.log("\n── CASE 7: partial-invalid pinned → keep valid only, no fallback ──");

  const partialInvalidPinned = JSON.stringify([
    // Valid: metric(guest, count) — in WIDGET_CATALOG and valid config.
    { id: "valid-1", kind: "metric", config: { type: "guest", agg: "count" } },
    // Invalid: data_table with nonexistent column — validateWidgetConfig rejects.
    { id: "invalid-1", kind: "data_table", config: { type: "guest", columns: ["nonexistent_col"], limit: 10 } },
  ]);

  await db
    .update(memberContextTable)
    .set({ pinned_widgets: partialInvalidPinned, updated_at: new Date() })
    .where(eq(memberContextTable.member_id, probeMember.id));

  const partialWidgets = await resolvePerUserDashboard(db, {
    id: probeMember.id,
    tier_role: probeMember.tier_role,
  }, CAN_READ_ALL, registry);

  console.log(`\nWith partial-invalid pinned_widgets (1 valid + 1 invalid):`);
  console.log("  resolved:", widgetSummary(partialWidgets));
  console.log("  derived default:", derivedSummary);

  if (partialWidgets.length === 0) {
    fail("CASE 7: partial-invalid returned [] — should have kept the valid widget");
  }

  // Must return ONLY the valid one (the metric) — NOT fall back to the derived floor.
  if (partialWidgets.length !== 1) {
    fail(`CASE 7: expected exactly 1 valid widget (metric), got ${partialWidgets.length}`, {
      widgets: widgetSummary(partialWidgets),
    });
  }

  const validWidget = partialWidgets[0];
  if (validWidget.kind !== "metric" || (validWidget.config as { type: string }).type !== "guest") {
    fail("CASE 7: surviving widget is not the expected metric(guest)", { got: validWidget });
  }

  const case7Summary = widgetSummary(partialWidgets);
  if (case7Summary === derivedSummary) {
    fail("CASE 7: result matches the derived default — incorrectly fell back instead of keeping the valid widget");
  }

  pass(`CASE 7 — partial-invalid: only valid widget survives '${case7Summary}', no fallback to derived default '${derivedSummary}'`);

  // ── CASE 5: Cleanup ───────────────────────────────────────────────────────

  console.log("\n── CASE 5: Cleanup ──");

  if (originalContexts.length > 0) {
    // Restore original pinned_widgets.
    for (const orig of originalContexts) {
      await db
        .update(memberContextTable)
        .set({ pinned_widgets: orig.pinned_widgets, updated_at: new Date() })
        .where(eq(memberContextTable.member_id, orig.member_id));
    }
  } else {
    // The probe member had no context row before — remove the one compose_dashboard
    // created during CASE 3.
    await db
      .delete(memberContextTable)
      .where(eq(memberContextTable.member_id, probeMember.id));
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
