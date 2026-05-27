/**
 * seed-decision-lifecycle.ts
 *
 * Populates a realistic "decision lifecycle" so community-intelligence metrics
 * + the self-correction loop compute NON-NULL values on live data.
 *
 * Design contract:
 *   - IDEMPOTENT: cleanup runs first — delete all demo rows, then re-insert.
 *   - DETERMINISTIC: fixed ISO timestamps + fixed pathway UUIDs.
 *   - TAGGED: blockers use blocked_work_ref prefix "demo-lifecycle";
 *             audit rows use via = "demo-lifecycle".
 *   - NON-DESTRUCTIVE: only deletes rows this script created.
 *
 * Usage:
 *   docker exec acropolisos-app npx tsx scripts/seed-decision-lifecycle.ts
 */

import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { action_audit } from "../lib/db/schema";
import { agent_blocker, member } from "../lib/db/schema.generated";
import {
  computeCommunityIntelligence,
  type MetricBlockerRow,
  type MetricAuditRow,
  type PolicyOf,
} from "../lib/metrics/community-intelligence";
import { computePathwayPreference } from "../lib/blockers/pathway-preference";

// ─────────────────────────────────────────────────────────────────────────────
// Proof-time policy map — covers all actions in the seed's action_audit rows.
// Source: seed/hostel/action-types/*.yaml + seed/small-community/action-types/*.yaml
// ─────────────────────────────────────────────────────────────────────────────
const POLICY_MAP: Record<string, "auto_apply" | "always_confirm"> = {
  // hostel
  log_incident: "auto_apply",
  check_in: "always_confirm",
  check_out: "always_confirm",
  claim_shift: "auto_apply",
  start_work_trade: "always_confirm",
  // small-community
  flag_blocker: "auto_apply",
  mark_notification_read: "auto_apply",
  resolve_blocker_with_pathway: "always_confirm",
  resolve_blocker_with_input: "always_confirm",
  resolve_blocker_with_custom: "always_confirm",
  dismiss_blocker: "always_confirm",
  change_tier: "always_confirm",
  promote_to_steward: "always_confirm",
};

const policyOf: PolicyOf = (name) => POLICY_MAP[name];

// ─────────────────────────────────────────────────────────────────────────────
// Fixed pathway UUIDs (deterministic — referenced by resolved_via_pathway_id)
// ─────────────────────────────────────────────────────────────────────────────
const PW = {
  // approval-group pathways
  A1_approve: "11000001-0000-4000-a000-000000000001",
  A1_defer: "11000001-0000-4000-a000-000000000002",
  A2_approve: "11000002-0000-4000-a000-000000000001",
  A2_defer: "11000002-0000-4000-a000-000000000002",
  A3_approve: "11000003-0000-4000-a000-000000000001",
  A3_request_more: "11000003-0000-4000-a000-000000000002",
  // confirmation-group pathways (stacked: all choose "confirm_and_proceed")
  C1_confirm: "22000001-0000-4000-a000-000000000001",
  C1_cancel: "22000001-0000-4000-a000-000000000002",
  C2_confirm: "22000002-0000-4000-a000-000000000001",
  C2_cancel: "22000002-0000-4000-a000-000000000002",
  C3_confirm: "22000003-0000-4000-a000-000000000001",
  C3_cancel: "22000003-0000-4000-a000-000000000002",
  // ambiguity-group pathways
  B1_clarify: "33000001-0000-4000-a000-000000000001",
  B1_skip: "33000001-0000-4000-a000-000000000002",
  // decision-group pathway
  D1_proceed: "44000001-0000-4000-a000-000000000001",
  D1_rollback: "44000001-0000-4000-a000-000000000002",
  // re-flag pair pathways
  RF1_confirm: "55000001-0000-4000-a000-000000000001",
  RF1_cancel: "55000001-0000-4000-a000-000000000002",
  RF2_confirm: "55000002-0000-4000-a000-000000000001",
  RF2_cancel: "55000002-0000-4000-a000-000000000002",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────
function ts(iso: string): Date {
  return new Date(iso);
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

  // ── STEP 1: Idempotent cleanup ──────────────────────────────────────────────
  console.log("\n=== CLEANUP (idempotent) ===");
  const deletedBlockers = await db
    .delete(agent_blocker)
    .where(like(agent_blocker.blocked_work_ref, "demo-lifecycle%"))
    .returning({ id: agent_blocker.id });
  console.log(`  Deleted ${deletedBlockers.length} demo agent_blocker rows`);

  const deletedAudit = await db
    .delete(action_audit)
    .where(eq(action_audit.via, "demo-lifecycle"))
    .returning({ id: action_audit.id });
  console.log(`  Deleted ${deletedAudit.length} demo action_audit rows`);

  // ── STEP 2: Look up real member IDs ────────────────────────────────────────
  console.log("\n=== MEMBER LOOKUP ===");
  const members = await db.select({ id: member.id, full_name: member.full_name }).from(member);
  if (members.length === 0) {
    console.error("No members found — run the hostel seed first.");
    process.exit(1);
  }
  // Cycle through up to 3 actors
  const actors = [
    members[0].id,
    members[Math.min(1, members.length - 1)].id,
    members[Math.min(2, members.length - 1)].id,
  ];
  console.log(`  Using actors: ${actors.join(", ")}`);

  // ── STEP 3: Insert resolved blockers ──────────────────────────────────────
  // 10 resolved blockers, spread across ≥3 reason_kinds.
  // confirmation group has 3 rows all choosing action.type "confirm_and_proceed"
  // so computePathwayPreference("confirmation") returns a non-empty map.
  console.log("\n=== INSERT RESOLVED BLOCKERS ===");

  // --- 3 × approval (A1, A2, A3) ---
  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: actors[0],
    reason_kind: "approval",
    summary: "Approve extended work-trade for guest g-001",
    detail: "Guest has requested a 4-week extension of their work-trade agreement beyond the standard 2-week cap.",
    blocked_work_ref: "demo-lifecycle/approval/A1",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: PW.A1_approve, label: "Approve extension", rationale: "Guest has good track record", action: { type: "extend_work_trade" }, reversibility: "moderate" },
      { id: PW.A1_defer, label: "Defer — review next week", rationale: "Need more context", action: { type: "defer_decision" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-01T09:00:00Z"),
    resolved_at: ts("2026-05-01T09:45:00Z"),   // 45-min latency
    resolved_via_pathway_id: PW.A1_approve,
  });
  console.log("  Inserted A1 (approval, resolved via extend_work_trade)");

  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: actors[1],
    reason_kind: "approval",
    summary: "Approve rate discount for long-stay booking",
    detail: "Booking BK-0005 requests 15% discount for 21-night stay. Policy cap is 10%.",
    blocked_work_ref: "demo-lifecycle/approval/A2",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: PW.A2_approve, label: "Approve discount", rationale: "Fills low-season beds", action: { type: "extend_work_trade" }, reversibility: "moderate" },
      { id: PW.A2_defer, label: "Offer standard 10% only", rationale: "Policy limit", action: { type: "defer_decision" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-03T14:00:00Z"),
    resolved_at: ts("2026-05-03T15:30:00Z"),   // 90-min latency
    resolved_via_pathway_id: PW.A2_approve,
  });
  console.log("  Inserted A2 (approval, resolved via extend_work_trade)");

  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: actors[2],
    reason_kind: "approval",
    summary: "Approve external cleaning contractor for deep-clean week",
    detail: "Regular cleaning crew unavailable during festival week. External contractor quote: EUR 600.",
    blocked_work_ref: "demo-lifecycle/approval/A3",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: PW.A3_approve, label: "Approve contractor", rationale: "Festival window is non-negotiable", action: { type: "extend_work_trade" }, reversibility: "moderate" },
      { id: PW.A3_request_more, label: "Request two more quotes", rationale: "Standard procurement policy", action: { type: "request_quotes" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-05T10:00:00Z"),
    resolved_at: ts("2026-05-05T10:20:00Z"),   // 20-min latency
    resolved_via_pathway_id: PW.A3_approve,
  });
  console.log("  Inserted A3 (approval, resolved via extend_work_trade)");
  // ↑ All 3 approval rows choose pathway with action.type "extend_work_trade".
  //   computePathwayPreference(rows, "approval") will return Map{"extend_work_trade"→3}

  // --- 3 × confirmation (C1, C2, C3) — all choose "confirm_and_proceed" ---
  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: actors[0],
    reason_kind: "confirmation",
    summary: "Confirm early check-in at 08:00 for group of 4",
    detail: "Standard check-in is 15:00. Group arriving at 08:00 by bus. Room D2 available.",
    blocked_work_ref: "demo-lifecycle/confirmation/C1",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: PW.C1_confirm, label: "Allow early check-in", rationale: "Room is ready", action: { type: "confirm_and_proceed" }, reversibility: "easy" },
      { id: PW.C1_cancel, label: "Decline — standard policy", rationale: "No cleaning crew until 14:00", action: { type: "send_notification" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-07T07:30:00Z"),
    resolved_at: ts("2026-05-07T07:50:00Z"),   // 20-min latency
    resolved_via_pathway_id: PW.C1_confirm,
  });
  console.log("  Inserted C1 (confirmation, resolved via confirm_and_proceed)");

  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: actors[1],
    reason_kind: "confirmation",
    summary: "Confirm late checkout at 13:00 for solo traveller",
    detail: "Guest BK-0003 needs extra 2 hours. No arrivals into that bed until 18:00.",
    blocked_work_ref: "demo-lifecycle/confirmation/C2",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: PW.C2_confirm, label: "Allow late checkout", rationale: "No conflict", action: { type: "confirm_and_proceed" }, reversibility: "easy" },
      { id: PW.C2_cancel, label: "Standard 11:00 checkout", rationale: "Keeps schedule predictable", action: { type: "send_notification" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-09T10:15:00Z"),
    resolved_at: ts("2026-05-09T10:30:00Z"),   // 15-min latency
    resolved_via_pathway_id: PW.C2_confirm,
  });
  console.log("  Inserted C2 (confirmation, resolved via confirm_and_proceed)");

  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: actors[2],
    reason_kind: "confirmation",
    summary: "Confirm reassignment of guest to different dorm room",
    detail: "Noise complaint from bunkmates; bed D1-B1 open in quieter room.",
    blocked_work_ref: "demo-lifecycle/confirmation/C3",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: PW.C3_confirm, label: "Approve reassignment", rationale: "Quick resolution to conflict", action: { type: "confirm_and_proceed" }, reversibility: "easy" },
      { id: PW.C3_cancel, label: "Mediate in-place", rationale: "Reassignment disrupts others", action: { type: "send_notification" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-11T22:00:00Z"),
    resolved_at: ts("2026-05-12T00:30:00Z"),   // 150-min latency
    resolved_via_pathway_id: PW.C3_confirm,
  });
  console.log("  Inserted C3 (confirmation, resolved via confirm_and_proceed)");

  // --- 2 × ambiguity (B1) + decision (D1) ---
  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: actors[0],
    reason_kind: "ambiguity",
    summary: "Unclear arrival date in booking form — 'June 1st or July 1st'?",
    detail: "Raw form submission has '01/06' which could be June 1 (DD/MM) or July 1 (MM/DD). Guest email unresponsive.",
    blocked_work_ref: "demo-lifecycle/ambiguity/B1",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: PW.B1_clarify, label: "Mark as June 1 and email guest", rationale: "EU locale default", action: { type: "send_notification" }, reversibility: "easy" },
      { id: PW.B1_skip, label: "Hold booking unconfirmed for 48h", rationale: "Avoid wrong date commitment", action: { type: "defer_decision" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-13T08:00:00Z"),
    resolved_at: ts("2026-05-13T09:00:00Z"),   // 60-min latency
    resolved_via_pathway_id: PW.B1_clarify,
  });
  console.log("  Inserted B1 (ambiguity, resolved)");

  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: actors[1],
    reason_kind: "decision",
    summary: "Decide whether to accept walk-in with no ID document",
    detail: "Walk-in guest lacks passport; has only a foreign driving licence. Local law requires valid ID.",
    blocked_work_ref: "demo-lifecycle/decision/D1",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: PW.D1_proceed, label: "Accept with waiver note", rationale: "Driving licence is valid ID in most jurisdictions", action: { type: "confirm_and_proceed" }, reversibility: "moderate" },
      { id: PW.D1_rollback, label: "Decline until passport provided", rationale: "Zero risk of regulatory breach", action: { type: "send_notification" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-15T16:00:00Z"),
    resolved_at: ts("2026-05-15T16:35:00Z"),   // 35-min latency
    resolved_via_pathway_id: PW.D1_proceed,
  });
  console.log("  Inserted D1 (decision, resolved)");

  // --- 2 × missing_data (MD1, MD2) for additional coverage ---
  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: actors[2],
    reason_kind: "missing_data",
    summary: "Emergency contact missing for under-18 guest",
    detail: "Booking BK-0009 is for a 16-year-old; emergency contact field blank. Required by house policy.",
    blocked_work_ref: "demo-lifecycle/missing_data/MD1",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: "aa000001-0000-4000-a000-000000000001", label: "Email guest for emergency contact", action: { type: "send_notification" }, reversibility: "easy" },
      { id: "aa000001-0000-4000-a000-000000000002", label: "Block check-in until resolved", action: { type: "defer_decision" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-17T11:00:00Z"),
    resolved_at: ts("2026-05-17T13:00:00Z"),   // 120-min latency
    resolved_via_pathway_id: "aa000001-0000-4000-a000-000000000001",
  });
  console.log("  Inserted MD1 (missing_data, resolved)");

  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: actors[0],
    reason_kind: "missing_data",
    summary: "Bank account details missing for work-trade stipend transfer",
    detail: "Work-trader Anna Vogt has no IBAN on file. Stipend payout of EUR 120 due.",
    blocked_work_ref: "demo-lifecycle/missing_data/MD2",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: "bb000002-0000-4000-a000-000000000001", label: "Request IBAN via member portal", action: { type: "send_notification" }, reversibility: "easy" },
      { id: "bb000002-0000-4000-a000-000000000002", label: "Defer to next pay cycle", action: { type: "defer_decision" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-19T09:00:00Z"),
    resolved_at: ts("2026-05-19T09:30:00Z"),   // 30-min latency
    resolved_via_pathway_id: "bb000002-0000-4000-a000-000000000001",
  });
  console.log("  Inserted MD2 (missing_data, resolved)");

  // ── STEP 4: Re-flagged pair (resolutionAccuracy < 1) ──────────────────────
  // Same (blocked_actor_id, reason_kind, summary) pair: RF1 resolved, then RF2
  // created AFTER RF1's resolved_at.
  console.log("\n=== INSERT RE-FLAGGED PAIR ===");

  const RE_FLAG_ACTOR = actors[0];
  const RE_FLAG_SUMMARY = "Overdue invoice from linen supplier — approve payment?";

  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: RE_FLAG_ACTOR,
    reason_kind: "approval",
    summary: RE_FLAG_SUMMARY,
    detail: "Invoice INV-2026-0441 from LinenCo for EUR 380. 14 days overdue.",
    blocked_work_ref: "demo-lifecycle/re-flag/RF1",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: PW.RF1_confirm, label: "Approve immediate payment", action: { type: "extend_work_trade" }, reversibility: "moderate" },
      { id: PW.RF1_cancel, label: "Request credit note first", action: { type: "defer_decision" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-20T10:00:00Z"),
    resolved_at: ts("2026-05-20T10:30:00Z"),   // resolved at 10:30
    resolved_via_pathway_id: PW.RF1_confirm,
  });
  console.log("  Inserted RF1 (resolved approval)");

  // RF2: created AFTER RF1's resolved_at — same triple → RF1 is re-flagged
  await db.insert(agent_blocker).values({
    id: randomUUID(),
    blocked_actor_id: RE_FLAG_ACTOR,
    reason_kind: "approval",
    summary: RE_FLAG_SUMMARY,  // SAME summary — triggers re-flag detection
    detail: "Invoice INV-2026-0441 again — payment was processed but supplier claims non-receipt.",
    blocked_work_ref: "demo-lifecycle/re-flag/RF2",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: PW.RF2_confirm, label: "Re-confirm payment with bank trace", action: { type: "extend_work_trade" }, reversibility: "moderate" },
      { id: PW.RF2_cancel, label: "Dispute with supplier", action: { type: "defer_decision" }, reversibility: "easy" },
    ]),
    status: "resolved",
    created_at: ts("2026-05-20T14:00:00Z"),   // AFTER RF1 resolved_at (10:30)
    resolved_at: ts("2026-05-20T15:00:00Z"),
    resolved_via_pathway_id: PW.RF2_confirm,
  });
  console.log("  Inserted RF2 (re-flag — same triple, created after RF1 resolved)");

  // ── STEP 5: action_audit rows for autonomyRatio ────────────────────────────
  // ~10 × log_incident (auto_apply, result:ok) + 4 × check_in (always_confirm, result:ok)
  // + a couple of error/replay rows (excluded by autonomyRatio).
  // autonomyRatio = auto_apply_ok / (auto_apply_ok + always_confirm_ok)
  //              = 10 / (10 + 4) ≈ 0.714
  console.log("\n=== INSERT ACTION AUDIT ROWS ===");

  const auditActor = actors[0];

  const logIncidentRows = [
    { subject_id: "log_incident", duration_ms: 142 },
    { subject_id: "log_incident", duration_ms: 98 },
    { subject_id: "log_incident", duration_ms: 201 },
    { subject_id: "log_incident", duration_ms: 175 },
    { subject_id: "log_incident", duration_ms: 134 },
    { subject_id: "log_incident", duration_ms: 188 },
    { subject_id: "log_incident", duration_ms: 210 },
    { subject_id: "log_incident", duration_ms: 155 },
    { subject_id: "log_incident", duration_ms: 167 },
    { subject_id: "log_incident", duration_ms: 193 },
  ];

  for (const row of logIncidentRows) {
    await db.insert(action_audit).values({
      id: randomUUID(),
      actor: auditActor,
      actor_role: "steward",
      via: "demo-lifecycle",
      subject_type: "action",
      subject_id: row.subject_id,
      before: null,
      after: null,
      metadata: {
        result: "ok",
        idempotency_key: randomUUID(),
        duration_ms: row.duration_ms,
        params: { category: "incident", severity: "low" },
      },
    });
  }
  console.log("  Inserted 10 × log_incident (auto_apply, ok)");

  const checkInRows = [
    { duration_ms: 320 },
    { duration_ms: 280 },
    { duration_ms: 415 },
    { duration_ms: 298 },
  ];

  for (const row of checkInRows) {
    await db.insert(action_audit).values({
      id: randomUUID(),
      actor: auditActor,
      actor_role: "steward",
      via: "demo-lifecycle",
      subject_type: "action",
      subject_id: "check_in",
      before: null,
      after: null,
      metadata: {
        result: "ok",
        idempotency_key: randomUUID(),
        duration_ms: row.duration_ms,
        params: { guest_id: "demo" },
      },
    });
  }
  console.log("  Inserted 4 × check_in (always_confirm, ok)");

  // A couple of error/replay rows — excluded by autonomyRatio (result !== "ok")
  await db.insert(action_audit).values({
    id: randomUUID(),
    actor: auditActor,
    actor_role: "steward",
    via: "demo-lifecycle",
    subject_type: "action",
    subject_id: "log_incident",
    before: null,
    after: null,
    metadata: {
      result: "error",
      idempotency_key: randomUUID(),
      duration_ms: 55,
      error_message: "DB constraint violation on incident_log.reported_by",
    },
  });
  console.log("  Inserted 1 × log_incident error (excluded from autonomyRatio)");

  await db.insert(action_audit).values({
    id: randomUUID(),
    actor: auditActor,
    actor_role: "steward",
    via: "demo-lifecycle",
    subject_type: "action",
    subject_id: "check_in",
    before: null,
    after: null,
    metadata: {
      result: "replay",
      idempotency_key: randomUUID(),
      replay_of_audit_id: randomUUID(),
      duration_ms: 12,
    },
  });
  console.log("  Inserted 1 × check_in replay (excluded from autonomyRatio)");

  // ── STEP 6: Self-verify ─────────────────────────────────────────────────────
  console.log("\n=== SELF-VERIFY ===");

  // Fetch ALL live blocker rows (demo + pre-existing open blockers)
  const allBlockers = await db.select().from(agent_blocker);
  // Fetch ALL live audit rows (filter to subject_type="action" is done inside metrics)
  const allAudits = await db.select().from(action_audit);

  // Build typed input shapes
  const metricBlockers: MetricBlockerRow[] = allBlockers.map((b) => ({
    status: b.status,
    created_at: b.created_at?.toISOString() ?? null,
    resolved_at: b.resolved_at?.toISOString() ?? null,
    resolved_via_pathway_id: b.resolved_via_pathway_id ?? null,
    reason_kind: b.reason_kind ?? null,
    blocked_actor_id: b.blocked_actor_id ?? null,
    summary: b.summary ?? null,
  }));

  const metricAudits: MetricAuditRow[] = allAudits.map((a) => ({
    subject_type: a.subject_type,
    subject_id: a.subject_id,
    metadata: a.metadata as { result?: string; [k: string]: unknown },
  }));

  const metrics = computeCommunityIntelligence(metricBlockers, metricAudits, policyOf);

  // pathway preference — "approval" has ≥3 resolved rows all choosing "extend_work_trade"
  const preferenceMap = computePathwayPreference(allBlockers, "approval");

  console.log("\n--- Community Intelligence Metrics ---");
  console.log(JSON.stringify(metrics, null, 2));
  console.log("\n--- Pathway Preference (approval) ---");
  const preferenceObj = Object.fromEntries(preferenceMap.entries());
  console.log(JSON.stringify(preferenceObj, null, 2));

  // ── Assertions ──────────────────────────────────────────────────────────────
  let passed = true;

  function assertNonNull(value: number | null, label: string) {
    if (value === null) {
      console.error(`  FAIL: ${label} is null — expected a non-null number`);
      passed = false;
    } else {
      console.log(`  PASS: ${label} = ${value}`);
    }
  }

  assertNonNull(metrics.autonomyRatio, "autonomyRatio");
  assertNonNull(metrics.scenarioAcceptanceRate, "scenarioAcceptanceRate");
  assertNonNull(metrics.decisionLatencyMsMedian, "decisionLatencyMsMedian");
  assertNonNull(metrics.coordinationCoverage, "coordinationCoverage");
  assertNonNull(metrics.resolutionAccuracy, "resolutionAccuracy");

  if (preferenceMap.size === 0) {
    console.error("  FAIL: pathwayPreference(approval) is empty — expected at least one entry");
    passed = false;
  } else {
    console.log(`  PASS: pathwayPreference(approval) has ${preferenceMap.size} entry/entries: ${JSON.stringify(preferenceObj)}`);
  }

  if (!passed) {
    console.error("\nACCEPTANCE FAIL — one or more KPIs are null or preference is empty");
    await (db.$client as { end: () => Promise<void> }).end();
    process.exit(1);
  }

  console.log("\nACCEPTANCE PASS");
  console.log("  autonomyRatio:", metrics.autonomyRatio);
  console.log("  scenarioAcceptanceRate:", metrics.scenarioAcceptanceRate);
  console.log("  decisionLatencyMsMedian:", metrics.decisionLatencyMsMedian, "ms");
  console.log("  coordinationCoverage:", metrics.coordinationCoverage);
  console.log("  resolutionAccuracy:", metrics.resolutionAccuracy);
  console.log("  pathwayPreference(approval):", preferenceObj);

  await (db.$client as { end: () => Promise<void> }).end();
  process.exit(0);
}

main().catch((err) => {
  console.error("SEED FAILED:", err);
  process.exit(1);
});
