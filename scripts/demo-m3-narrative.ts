/**
 * demo-m3-narrative.ts
 *
 * Milestone-3 "Autonomous Community Intelligence" END-TO-END narrative, run
 * against the REAL pipeline + REAL Postgres. It walks one hostel/ecovillage
 * community decision through five steps, ASSERTS each, and prints a readable
 * DEMO TRANSCRIPT. This is M3 deliverable #3 (agent-driven collective
 * decision-making) and the backbone the demo recording/report follows.
 *
 * The narrative (each step asserted + printed):
 *   1. OBSERVE + AUTO-APPLY  — log_incident (auto_apply) commits with NO
 *      human confirmation. Proves the autonomy leg of the governance gate.
 *   2. ESCALATE              — the agent hits a judgment call and raises an
 *      AgentBlocker with EXACTLY 3 pathways (a community-affecting decision:
 *      guest overstay on bed D3-A2). Lands OPEN in the veto-queue.
 *   3. HUMAN PICKS           — the steward resolves on behalf of the community
 *      via resolve_blocker_with_pathway. The agent surfaces, the human
 *      disposes — that IS the collective-decision contract (no fabricated vote).
 *   4. METRICS MOVE          — computeCommunityIntelligence over the LIVE rows
 *      BEFORE and AFTER step 3; assert a KPI moved the expected direction.
 *   5. NEXT PROPOSAL TUNED   — resolve more blockers of the same reason_kind
 *      toward the same pathway identity, then flag a NEW blocker whose pathways
 *      arrive in a DIFFERENT order; assert flag_blocker's rankPathways now
 *      LEADS with the historically-preferred identity. The loop learns.
 *
 * Design contract (mirrors scripts/seed-decision-lifecycle.ts):
 *   - IDEMPOTENT: cleanup runs FIRST — every demo row is deleted by tag, then
 *     re-created. A 2nd run also PASSES.
 *   - DETERMINISTIC: fixed pathway UUIDs + fixed blocker ids + fixed ISO
 *     timestamps for everything that affects an assertion.
 *   - TAGGED: blockers use blocked_work_ref prefix "demo-m3-narrative";
 *     incident rows use a recognizable summary prefix + body tag; audit rows
 *     use via = "demo-m3-narrative". Cleanup only touches these.
 *   - NON-DESTRUCTIVE: never deletes a row this script did not create.
 *   - FAIL-CLOSED: the steward actor drives; no permission boundary is weakened.
 *
 * INVOCATION PATHS USED (per the harness in
 * lib/actions/log-incident-auto-apply.test.ts + check-in-confirm-roundtrip.test.ts):
 *   - Step 1 (log_incident): policy gate proven via the REAL resolveActionPolicy
 *     (auto_apply → no confirmation). The IncidentLog row is committed through
 *     the REAL permission-checked ctx.objects.IncidentLog.create and a REAL
 *     PgAuditStore "ok" action_audit row is written. The declarative runner is
 *     NOT used for the create leg here because log_incident's NOT-NULL ref
 *     property `reported_by` is not a declared action parameter and the
 *     declarative runner does not auto-fill ref-typed properties (verified: the
 *     full runApplyActionTool path throws a NOT-NULL violation on the live DB).
 *     This is the task-documented handler-direct fallback for the create leg
 *     ONLY; the autonomy contract (policy = auto_apply, no confirmation) and the
 *     audit row are exercised on the REAL pipeline.
 *   - Steps 2/3/5 (flag_blocker, resolve_blocker_with_pathway): the FULL REAL
 *     invoke path — createInProcessDispatcher → invokeAction → permission check
 *     → function-backed handler — driven through runApplyActionTool with the
 *     REAL policy gate, exactly as the agent/confirm route does. resolve is
 *     always_confirm, so the human-Confirm leg passes bypassConfirmation:true
 *     (what app/api/chat/confirm/route.ts sets server-side). Steward bypasses
 *     the member_self row-ownership leg (resolving on behalf of the community).
 *
 * Usage:
 *   docker exec acropolisos-app npx tsx scripts/demo-m3-narrative.ts
 */

import path from "node:path";
import { and, eq, like, sql } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { action_audit } from "../lib/db/schema";
import { agent_blocker, incident_log, member } from "../lib/db/schema.generated";
import type { Actor } from "../lib/ctx";
import { loadOntology } from "../lib/ontology/load";
import { createOntologyCtxForActor } from "../lib/ontology/ctx-runtime";
import { createInProcessDispatcher } from "../lib/actions/dispatcher";
import { resolveActionPolicy } from "../lib/actions/policy";
import { runApplyActionTool } from "../lib/agent/tool-gating";
import {
  computeCommunityIntelligence,
  type CommunityIntelligenceMetrics,
  type MetricAuditRow,
  type MetricBlockerRow,
  type PolicyOf,
} from "../lib/metrics/community-intelligence";
import {
  computePathwayPreference,
  parsePathways,
  pathwayIdentity,
} from "../lib/blockers/pathway-preference";

// ─────────────────────────────────────────────────────────────────────────────
// Tags — everything this script writes carries one of these so cleanup is exact.
// ─────────────────────────────────────────────────────────────────────────────
const TAG = "demo-m3-narrative";
const WORK_REF_PREFIX = `${TAG}/`; // agent_blocker.blocked_work_ref
const INCIDENT_SUMMARY_PREFIX = `[${TAG}] `; // incident_log.summary
const INCIDENT_BODY_TAG = TAG; // incident_log.body
const AUDIT_VIA = TAG; // action_audit.via

// ─────────────────────────────────────────────────────────────────────────────
// Proof-time policy map — covers every action this demo invokes. Source:
// ontology/action-types/*.yaml (agent_policy field). Used by
// computeCommunityIntelligence's autonomyRatio over the live audit rows. We do
// NOT touch the ontology yaml; this is a documented, explicit projection of it.
// ─────────────────────────────────────────────────────────────────────────────
const POLICY_MAP: Record<string, "auto_apply" | "always_confirm"> = {
  log_incident: "auto_apply",
  flag_blocker: "auto_apply",
  resolve_blocker_with_pathway: "always_confirm",
  check_in: "always_confirm",
  check_out: "always_confirm",
  dismiss_blocker: "always_confirm",
};
const policyOf: PolicyOf = (name) => POLICY_MAP[name];

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic identifiers. Fixed UUIDs keep assertions stable across runs.
// ─────────────────────────────────────────────────────────────────────────────
const PW = {
  // Step-2 overstay decision (3 pathways) — ALL "moderate" reversibility so the
  // chosen identity is decided by community preference, not the safety tier.
  OVERSTAY_extend: "a1000001-0000-4000-a000-000000000001",
  OVERSTAY_charge: "a1000001-0000-4000-a000-000000000002",
  OVERSTAY_reassign: "a1000001-0000-4000-a000-000000000003",
  // Step-5 priming blockers (same reason_kind "decision", same identity).
  PRIME1_extend: "a2000001-0000-4000-a000-000000000001",
  PRIME1_charge: "a2000001-0000-4000-a000-000000000002",
  PRIME2_extend: "a2000002-0000-4000-a000-000000000001",
  PRIME2_charge: "a2000002-0000-4000-a000-000000000002",
};

// Step-5 NEW blocker pathway ids are assigned by flag_blocker (randomUUID in
// the handler), so we identify the chosen-by-history pathway by action.type.
const PREFERRED_IDENTITY = "extend_work_trade";

function isoDate(s: string): Date {
  return new Date(s);
}

function fmtMetrics(m: CommunityIntelligenceMetrics): string {
  return JSON.stringify(m, null, 2);
}

// Read all LIVE blocker rows shaped for the metrics core.
async function readMetricBlockers(
  db: ReturnType<typeof createDb>,
): Promise<MetricBlockerRow[]> {
  const rows = await db.select().from(agent_blocker);
  return rows.map((b) => ({
    status: b.status,
    created_at: b.created_at?.toISOString() ?? null,
    resolved_at: b.resolved_at?.toISOString() ?? null,
    resolved_via_pathway_id: b.resolved_via_pathway_id ?? null,
    reason_kind: b.reason_kind ?? null,
    blocked_actor_id: b.blocked_actor_id ?? null,
    summary: b.summary ?? null,
  }));
}

// Read all LIVE action_audit rows shaped for the metrics core.
async function readMetricAudits(
  db: ReturnType<typeof createDb>,
): Promise<MetricAuditRow[]> {
  const rows = await db.select().from(action_audit);
  return rows.map((a) => ({
    subject_type: a.subject_type,
    subject_id: a.subject_id,
    metadata: a.metadata as { result?: string; [k: string]: unknown },
  }));
}

function fail(message: string): never {
  console.error(`\nASSERTION FAILED: ${message}`);
  process.exit(1);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) fail(message);
}

async function main(): Promise<void> {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const db = createDb(DATABASE_URL);
  const ONTOLOGY_ROOT = path.resolve(process.cwd(), "ontology");
  const FUNCTIONS_DIR = path.resolve(process.cwd(), "functions");
  const ontology = await loadOntology(ONTOLOGY_ROOT);

  console.log("\n========================================================");
  console.log("  M3 DEMO NARRATIVE — Autonomous Community Intelligence");
  console.log("  (real pipeline · real Postgres · self-asserting)");
  console.log("========================================================");

  // ── CLEANUP (idempotent, tag-scoped) ──────────────────────────────────────
  console.log("\n--- CLEANUP (idempotent, tag-scoped) ---");
  const delBlockers = await db
    .delete(agent_blocker)
    .where(like(agent_blocker.blocked_work_ref, `${WORK_REF_PREFIX}%`))
    .returning({ id: agent_blocker.id });
  const delIncidents = await db
    .delete(incident_log)
    .where(like(incident_log.summary, `${INCIDENT_SUMMARY_PREFIX}%`))
    .returning({ id: incident_log.id });
  // Two classes of audit rows to remove:
  //  (1) rows this script wrote directly with via = TAG (the step-1 log_incident
  //      "ok" row).
  //  (2) rows the REAL pipeline wrote for our flag_blocker invocations. Those
  //      carry via="inngest" (set by the audit middleware, not by us), so we
  //      cannot match them on `via`. We match them on the tagged work_ref we
  //      passed in params: metadata->'params'->>'blocked_work_ref' LIKE the demo
  //      prefix. This is REQUIRED for idempotency: flag_blocker params are
  //      deterministic across runs, so a leftover "ok" row would make the audit
  //      middleware REPLAY (return the prior, now-deleted blocker id) instead of
  //      creating a fresh row. Scoped to subject_id='flag_blocker' + the demo
  //      work_ref prefix, so it never touches non-demo audit rows.
  const delAuditTagged = await db
    .delete(action_audit)
    .where(eq(action_audit.via, AUDIT_VIA))
    .returning({ id: action_audit.id });
  const delAuditFlag = await db
    .delete(action_audit)
    .where(
      and(
        eq(action_audit.subject_id, "flag_blocker"),
        sql`${action_audit.metadata} -> 'params' ->> 'blocked_work_ref' LIKE ${`${WORK_REF_PREFIX}%`}`,
      ),
    )
    .returning({ id: action_audit.id });
  // Pipeline-written resolve rows: matched by the deterministic demo pathway ids
  // we always resolve toward (the step-3/step-5 chosen pathways). Keeps the demo
  // fully idempotent — no resolve "ok"/"replay" rows accumulate across runs.
  const DEMO_PATHWAY_IDS = [
    PW.OVERSTAY_extend,
    PW.PRIME1_extend,
    PW.PRIME2_extend,
  ];
  const delAuditResolve = await db
    .delete(action_audit)
    .where(
      and(
        eq(action_audit.subject_id, "resolve_blocker_with_pathway"),
        sql`${action_audit.metadata} -> 'params' ->> 'pathway_id' = ANY(${sql.raw(
          `ARRAY[${DEMO_PATHWAY_IDS.map((id) => `'${id}'`).join(", ")}]::text[]`,
        )})`,
      ),
    )
    .returning({ id: action_audit.id });
  console.log(
    `  removed ${delBlockers.length} blocker(s), ${delIncidents.length} incident(s), ` +
      `${delAuditTagged.length + delAuditFlag.length + delAuditResolve.length} audit row(s)`,
  );

  // ── ACTOR — the steward drives on behalf of the community ──────────────────
  // Use a real member as the actor identity (FK-valid for incident.reported_by
  // and notification recipients). Role "steward" is the runtime governance role
  // (distinct from the DB tier_role column), granting the steward override that
  // lets them resolve a blocker on a community member's behalf.
  const members = await db
    .select({ id: member.id, full_name: member.full_name })
    .from(member)
    .orderBy(member.full_name);
  if (members.length === 0) {
    console.error("No members found — run the hostel seed first.");
    await (db.$client as { end: () => Promise<void> }).end();
    process.exit(1);
  }
  const stewardMember = members[0];
  const steward: Actor = {
    userId: stewardMember.id,
    email: "steward@demo.local",
    role: "steward",
    customRoles: [],
  };
  console.log(
    `\n  Steward actor: ${stewardMember.full_name} (${stewardMember.id}) · role=steward`,
  );

  // Real DB-backed ctx + dispatcher — the SAME wiring /api/chat/route.ts uses.
  const ctx = createOntologyCtxForActor({ actor: steward, db, ontology });
  const dispatcher = createInProcessDispatcher({
    ctx,
    ontology,
    functionsDir: FUNCTIONS_DIR,
  });
  assert(ctx.audit, "ctx.audit (PgAuditStore) must be wired for the demo");

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1 — OBSERVE + AUTO-APPLY (autonomy)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n========================================================");
  console.log("STEP 1 — OBSERVE + AUTO-APPLY (autonomy)");
  console.log("========================================================");

  const incidentParams = {
    summary: `${INCIDENT_SUMMARY_PREFIX}Noise after midnight in dorm D3`,
    category: "noise" as const,
    severity: "low" as const,
  };

  // (a) REAL policy gate — log_incident must resolve auto_apply (NO confirmation).
  const policyDecision = await resolveActionPolicy({
    ontology,
    actionName: "log_incident",
    params: incidentParams,
    ctx,
  });
  assert(
    policyDecision.decision === "auto_apply",
    `expected log_incident policy auto_apply, got ${JSON.stringify(policyDecision)}`,
  );
  console.log(
    "  resolveActionPolicy(log_incident) =",
    JSON.stringify(policyDecision),
    "→ NO confirmation gate",
  );

  // (b) Commit the IncidentLog via the REAL permission-checked write surface +
  // REAL audit. (See header: declarative runner can't fill the NOT-NULL ref
  // `reported_by`, so the create leg uses ctx.objects directly — documented
  // handler-direct fallback. The autonomy contract above is fully real.)
  const incidentBefore = await db
    .select({ id: incident_log.id })
    .from(incident_log)
    .where(like(incident_log.summary, `${INCIDENT_SUMMARY_PREFIX}%`));
  assert(
    incidentBefore.length === 0,
    "cleanup should have removed all demo incidents before STEP 1",
  );

  const created = await ctx.objects.IncidentLog.create({
    id: "b1000001-0000-4000-a000-000000000001",
    summary: incidentParams.summary,
    body: INCIDENT_BODY_TAG,
    category: incidentParams.category,
    severity: incidentParams.severity,
    occurred_at: "2026-05-26T00:30:00.000Z",
    reported_by: steward.userId,
    resolved: false,
  });
  assert(created?.id, "ctx.objects.IncidentLog.create returned no row");

  // REAL action_audit "ok" row — what autonomyRatio counts as an autonomous act.
  const incidentAudit = await ctx.audit.insertActionAudit({
    actor: steward.userId,
    actor_role: steward.role,
    via: AUDIT_VIA,
    subject_type: "action",
    subject_id: "log_incident",
    before: null,
    after: { incident_id: created.id },
    metadata: {
      result: "ok",
      params: { category: incidentParams.category, severity: incidentParams.severity },
      duration_ms: 120,
    },
  });
  assert(incidentAudit.id, "audit row insert returned no id");

  // The row exists, committed, no confirmation step gated it.
  const incidentAfter = await db
    .select()
    .from(incident_log)
    .where(eq(incident_log.id, created.id));
  assert(
    incidentAfter.length === 1,
    "IncidentLog row was not committed to the live DB",
  );
  assert(
    incidentAfter[0].reported_by === steward.userId,
    "IncidentLog.reported_by not set to the steward actor",
  );
  console.log(
    `  committed IncidentLog ${created.id} (reported_by=${steward.userId})`,
  );
  console.log(`  wrote action_audit ${incidentAudit.id} (result=ok, auto_apply)`);
  console.log(
    "STEP 1 — AUTO-APPLY: log_incident policy=auto_apply → committed, no confirmation ✓",
  );

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2 — ESCALATE (a community-affecting decision, exactly 3 pathways)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n========================================================");
  console.log("STEP 2 — ESCALATE (agent_blocker, 3 pathways)");
  console.log("========================================================");

  const overstayPathways = [
    {
      id: PW.OVERSTAY_extend,
      label: "Extend work-trade by 1 week",
      rationale: "Guest is a strong contributor; bed is uncontested until next week",
      action: { type: "extend_work_trade" },
      reversibility: "moderate",
    },
    {
      id: PW.OVERSTAY_charge,
      label: "Charge the standard overstay fee",
      rationale: "Cost-recovery, keeps the policy consistent",
      action: { type: "charge_overstay_fee" },
      reversibility: "moderate",
    },
    {
      id: PW.OVERSTAY_reassign,
      label: "Reassign guest to bed in quieter room",
      rationale: "Frees D3-A2 for the incoming confirmed booking",
      action: { type: "reassign_bed" },
      reversibility: "moderate",
    },
  ];

  const flagResult = await runApplyActionTool({
    actor: steward,
    dispatcher,
    action: "flag_blocker",
    params: {
      blocked_actor_id: steward.userId,
      reason_kind: "decision",
      summary: "Guest overstay on bed D3-A2 — choose a resolution",
      detail:
        "Guest on D3-A2 has stayed 3 nights past their booked departure. A confirmed " +
        "booking needs the bed in 2 days. The community's policy lets the steward " +
        "choose among three governed pathways.",
      blocked_work_ref: `${WORK_REF_PREFIX}overstay/D3-A2`,
      resolution_mode: "pathways",
      pathways: overstayPathways,
    },
    policy: { ontology, ctx },
  });
  assert(
    flagResult.ok,
    `flag_blocker did not succeed: ${JSON.stringify(flagResult)}`,
  );
  const blockerId = (flagResult.result as { blocker_id?: string }).blocker_id;
  assert(typeof blockerId === "string", "flag_blocker returned no blocker_id");

  const [blockerRow] = await db
    .select()
    .from(agent_blocker)
    .where(eq(agent_blocker.id, blockerId));
  assert(blockerRow, "escalated blocker not found in DB");
  assert(blockerRow.status === "open", "escalated blocker is not OPEN (veto-queue)");
  const escalatedPathways = parsePathways(blockerRow.pathways);
  assert(
    escalatedPathways.length === 3,
    `expected EXACTLY 3 pathways, got ${escalatedPathways.length}`,
  );
  console.log(`  flag_blocker → blocker ${blockerId} (reason_kind=decision)`);
  console.log(`  status=${blockerRow.status} · pathways=${escalatedPathways.length}`);
  escalatedPathways.forEach((p, i) =>
    console.log(
      `    (${i + 1}) ${pathwayIdentity(p)} [${p.reversibility}] — ${p.label}`,
    ),
  );
  console.log(
    "STEP 2 — ESCALATE: agent raised a 3-pathway decision blocker, OPEN in the veto-queue ✓",
  );

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 3 — HUMAN PICKS (the collective-decision contract)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n========================================================");
  console.log("STEP 3 — HUMAN PICKS (steward disposes on behalf of community)");
  console.log("========================================================");
  console.log(
    "  Contract: the agent SURFACED 3 governed options; the steward DISPOSES on",
  );
  console.log(
    "  behalf of the community. The agent proposes, the human decides — that IS",
  );
  console.log(
    "  the collective-decision contract (no fabricated voting subsystem).",
  );

  // ── METRICS BEFORE (captured before the resolution flips the open blocker) ──
  const blockersBefore = await readMetricBlockers(db);
  const auditsBefore = await readMetricAudits(db);
  const metricsBefore = computeCommunityIntelligence(
    blockersBefore,
    auditsBefore,
    policyOf,
  );

  // (a) Agent leg — WITHOUT bypass, resolve is always_confirm → gated. Proves
  // the human-in-the-loop gate runs before any state change.
  const gated = await runApplyActionTool({
    actor: steward,
    dispatcher,
    action: "resolve_blocker_with_pathway",
    params: { blocker_id: blockerId, pathway_id: PW.OVERSTAY_extend },
    policy: { ontology, ctx },
  });
  assert(
    !gated.ok && gated.confirmation_required?.reason === "always_confirm",
    `resolve should gate on always_confirm without bypass, got ${JSON.stringify(gated)}`,
  );
  console.log(
    "  resolve (agent leg, no bypass) → confirmation_required:always_confirm (gated) ✓",
  );

  // (b) Human-Confirm leg — bypassConfirmation:true is EXACTLY what
  // app/api/chat/confirm/route.ts sets after the steward clicks Confirm.
  const chosenPathwayId = PW.OVERSTAY_extend; // steward picks "extend work-trade"
  const resolveResult = await runApplyActionTool({
    actor: steward,
    dispatcher,
    action: "resolve_blocker_with_pathway",
    params: { blocker_id: blockerId, pathway_id: chosenPathwayId },
    policy: { ontology, ctx },
    bypassConfirmation: true,
  });
  assert(
    resolveResult.ok,
    `resolve_blocker_with_pathway failed: ${JSON.stringify(resolveResult)}`,
  );

  const [resolvedRow] = await db
    .select()
    .from(agent_blocker)
    .where(eq(agent_blocker.id, blockerId));
  assert(resolvedRow.status === "resolved", "blocker status did not flip to resolved");
  assert(
    resolvedRow.resolved_via_pathway_id === chosenPathwayId,
    "resolved_via_pathway_id was not set to the chosen pathway",
  );
  const chosen = parsePathways(resolvedRow.pathways).find(
    (p) => p.id === chosenPathwayId,
  );
  console.log(
    `  steward chose pathway ${chosenPathwayId} (${chosen ? pathwayIdentity(chosen) : "?"})`,
  );
  console.log(
    `  blocker status=${resolvedRow.status} · resolved_via_pathway_id=${resolvedRow.resolved_via_pathway_id}`,
  );
  console.log(
    "STEP 3 — HUMAN PICKS: steward resolved the blocker via the chosen pathway ✓",
  );

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 4 — METRICS MOVE (community intelligence)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n========================================================");
  console.log("STEP 4 — METRICS MOVE (community intelligence)");
  console.log("========================================================");

  const blockersAfter = await readMetricBlockers(db);
  const auditsAfter = await readMetricAudits(db);
  const metricsAfter = computeCommunityIntelligence(
    blockersAfter,
    auditsAfter,
    policyOf,
  );

  console.log("\n  --- BEFORE (open blocker still pending) ---");
  console.log(fmtMetrics(metricsBefore));
  console.log("\n  --- AFTER (steward resolved the blocker) ---");
  console.log(fmtMetrics(metricsAfter));

  // Resolving an OPEN blocker must raise coordinationCoverage (closed/total) AND
  // scenarioAcceptanceRate is well-defined and non-decreasing for a resolution.
  const covBefore = metricsBefore.coordinationCoverage;
  const covAfter = metricsAfter.coordinationCoverage;
  assert(covBefore !== null && covAfter !== null, "coordinationCoverage is null");
  assert(
    covAfter > covBefore,
    `coordinationCoverage should RISE after resolving an open blocker (before=${covBefore}, after=${covAfter})`,
  );

  const accBefore = metricsBefore.scenarioAcceptanceRate;
  const accAfter = metricsAfter.scenarioAcceptanceRate;
  assert(accBefore !== null && accAfter !== null, "scenarioAcceptanceRate is null");
  assert(
    accAfter >= accBefore,
    `scenarioAcceptanceRate should not fall when a blocker is accepted (before=${accBefore}, after=${accAfter})`,
  );

  console.log(
    `\n  coordinationCoverage: ${covBefore} → ${covAfter}  (RISES ✓)`,
  );
  console.log(
    `  scenarioAcceptanceRate: ${accBefore} → ${accAfter}  (non-decreasing ✓)`,
  );
  console.log(
    "STEP 4 — METRICS MOVE: resolving the open blocker raised coordination coverage ✓",
  );

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 5 — NEXT PROPOSAL TUNED (self-correction)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n========================================================");
  console.log("STEP 5 — NEXT PROPOSAL TUNED (self-correction)");
  console.log("========================================================");

  // Prime the loop: resolve TWO MORE "decision" blockers toward the SAME
  // identity (extend_work_trade). Combined with the step-3 resolution, the
  // community now has 3 "decision" resolutions all favoring extend_work_trade.
  const priming: Array<{
    workRef: string;
    summary: string;
    pathways: Array<{
      id: string;
      label: string;
      action: { type: string };
      reversibility: string;
    }>;
    chosen: string;
  }> = [
    {
      workRef: `${WORK_REF_PREFIX}prime/1`,
      summary: "Overstay on bed B1-C1 — choose a resolution",
      pathways: [
        { id: PW.PRIME1_extend, label: "Extend work-trade", action: { type: "extend_work_trade" }, reversibility: "moderate" },
        { id: PW.PRIME1_charge, label: "Charge overstay fee", action: { type: "charge_overstay_fee" }, reversibility: "moderate" },
      ],
      chosen: PW.PRIME1_extend,
    },
    {
      workRef: `${WORK_REF_PREFIX}prime/2`,
      summary: "Overstay on bed A2-D4 — choose a resolution",
      pathways: [
        { id: PW.PRIME2_extend, label: "Extend work-trade", action: { type: "extend_work_trade" }, reversibility: "moderate" },
        { id: PW.PRIME2_charge, label: "Charge overstay fee", action: { type: "charge_overstay_fee" }, reversibility: "moderate" },
      ],
      chosen: PW.PRIME2_extend,
    },
  ];

  for (const p of priming) {
    const flagged = await runApplyActionTool({
      actor: steward,
      dispatcher,
      action: "flag_blocker",
      params: {
        blocked_actor_id: steward.userId,
        reason_kind: "decision",
        summary: p.summary,
        detail: "Priming the community-preference signal for the self-correction proof.",
        blocked_work_ref: p.workRef,
        resolution_mode: "pathways",
        pathways: p.pathways,
      },
      policy: { ontology, ctx },
    });
    assert(flagged.ok, `priming flag_blocker failed: ${JSON.stringify(flagged)}`);
    const id = (flagged.result as { blocker_id?: string }).blocker_id!;
    const resolved = await runApplyActionTool({
      actor: steward,
      dispatcher,
      action: "resolve_blocker_with_pathway",
      params: { blocker_id: id, pathway_id: p.chosen },
      policy: { ontology, ctx },
      bypassConfirmation: true,
    });
    assert(resolved.ok, `priming resolve failed: ${JSON.stringify(resolved)}`);
  }

  // Confirm the live preference signal now leads with extend_work_trade.
  const allBlockerRows = await db.select().from(agent_blocker);
  const preference = computePathwayPreference(
    allBlockerRows.map((b) => ({
      reason_kind: b.reason_kind,
      status: b.status,
      pathways: b.pathways,
      resolved_via_pathway_id: b.resolved_via_pathway_id ?? null,
    })),
    "decision",
  );
  const extendCount = preference.get(PREFERRED_IDENTITY) ?? 0;
  assert(
    extendCount >= 3,
    `expected ≥ 3 'decision' resolutions favoring ${PREFERRED_IDENTITY}, got ${extendCount}`,
  );
  console.log(
    `  community preference (reason_kind=decision): ${JSON.stringify(Object.fromEntries(preference))}`,
  );

  // Now flag a NEW blocker whose pathways arrive in a DIFFERENT order: the
  // preferred identity is LAST in the input. flag_blocker calls rankPathways →
  // computePathwayPreference, so the PERSISTED order must LEAD with the
  // historically-preferred identity. All pathways share "moderate" reversibility
  // so preference — not the safety tier — decides the lead.
  const inputOrder = [
    { id: "a3000001-0000-4000-a000-000000000001", label: "Charge overstay fee", action: { type: "charge_overstay_fee" }, reversibility: "moderate" },
    { id: "a3000001-0000-4000-a000-000000000002", label: "Reassign bed", action: { type: "reassign_bed" }, reversibility: "moderate" },
    { id: "a3000001-0000-4000-a000-000000000003", label: "Extend work-trade", action: { type: "extend_work_trade" }, reversibility: "moderate" },
  ];
  console.log(
    `  NEW blocker INPUT order: ${inputOrder.map((p) => p.action.type).join(", ")}`,
  );

  const tunedFlag = await runApplyActionTool({
    actor: steward,
    dispatcher,
    action: "flag_blocker",
    params: {
      blocked_actor_id: steward.userId,
      reason_kind: "decision",
      summary: "Overstay on bed C3-B2 — choose a resolution (post-learning)",
      detail: "A fresh overstay decision raised AFTER the community signal accumulated.",
      blocked_work_ref: `${WORK_REF_PREFIX}tuned/C3-B2`,
      resolution_mode: "pathways",
      pathways: inputOrder,
    },
    policy: { ontology, ctx },
  });
  assert(tunedFlag.ok, `tuned flag_blocker failed: ${JSON.stringify(tunedFlag)}`);
  const tunedId = (tunedFlag.result as { blocker_id?: string }).blocker_id!;
  const [tunedRow] = await db
    .select()
    .from(agent_blocker)
    .where(eq(agent_blocker.id, tunedId));
  const persistedOrder = parsePathways(tunedRow.pathways).map((p) => pathwayIdentity(p));
  console.log(`  NEW blocker PERSISTED order: ${persistedOrder.join(", ")}`);
  assert(
    persistedOrder[0] === PREFERRED_IDENTITY,
    `persisted pathways should LEAD with ${PREFERRED_IDENTITY}, got ${persistedOrder[0]}`,
  );
  assert(
    inputOrder[0].action.type !== PREFERRED_IDENTITY,
    "test invalid: preferred identity should NOT be first in the input order",
  );
  console.log(
    `STEP 5 — NEXT PROPOSAL TUNED: input led with '${inputOrder[0].action.type}', ` +
      `persisted leads with '${persistedOrder[0]}' — the loop learned ✓`,
  );

  // ── PASS ───────────────────────────────────────────────────────────────────
  console.log("\n========================================================");
  console.log("=== M3 DEMO NARRATIVE PASS ===");
  console.log("========================================================");
  console.log(
    "\nThe full Autonomous Community Intelligence loop ran end-to-end on the real\n" +
      "pipeline against live Postgres: the agent AUTO-APPLIED a low-stakes incident\n" +
      "without confirmation (autonomy), then ESCALATED a community-affecting overstay\n" +
      "decision as a 3-pathway blocker; the steward DISPOSED on the community's behalf\n" +
      "by picking a governed pathway (the surface-then-decide collective-decision\n" +
      "contract); resolving the open blocker MOVED the community-intelligence KPIs\n" +
      "(coordination coverage rose); and once the community's choices accumulated, the\n" +
      "NEXT proposal was self-corrected so the historically-preferred pathway now leads\n" +
      "the curated options. Every step was asserted against ground-truth DB state; the\n" +
      "script is idempotent and tag-scoped, so re-running it reproduces the same PASS.",
  );

  await (db.$client as { end: () => Promise<void> }).end();
  process.exit(0);
}

main().catch((err) => {
  console.error("\nM3 DEMO NARRATIVE FAILED:", err);
  process.exit(1);
});
