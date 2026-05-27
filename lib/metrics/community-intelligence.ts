/**
 * Community Intelligence Metrics — pure computation core.
 *
 * All functions are deterministic: they accept already-fetched rows as
 * arguments, perform no I/O, make no DB calls, and reference no ontology
 * imports. They are safe to test in a pure Node.js/vitest environment.
 *
 * Ratios return a number in [0, 1], or null when the denominator is zero
 * ("no data" — never NaN, never a fake 0).
 */

// ---------------------------------------------------------------------------
// Input shapes (mirror real DB rows; caller fetches, this module computes)
// ---------------------------------------------------------------------------

/** A row from the agent_blocker object type — escalations from agent → human. */
export interface MetricBlockerRow {
  status: string;
  created_at?: string | null;
  resolved_at?: string | null;
  resolved_via_pathway_id?: string | null;
  reason_kind?: string | null;
  blocked_actor_id?: string | null;
  summary?: string | null;
}

/** A row from the action_audit table — every agent/inngest action invocation. */
export interface MetricAuditRow {
  subject_type?: string;
  subject_id?: string;
  metadata?: { result?: string; [k: string]: unknown };
}

/** The policy attached to a named action, resolved by the caller. */
export type AgentPolicy = "auto_apply" | "always_confirm" | (string & {});

/** Caller-supplied lookup: returns the policy for an action name, or undefined if unknown. */
export type PolicyOf = (actionName: string) => AgentPolicy | undefined;

// ---------------------------------------------------------------------------
// Aggregate return type
// ---------------------------------------------------------------------------

export interface CommunityIntelligenceMetrics {
  autonomyRatio: number | null;
  scenarioAcceptanceRate: number | null;
  decisionLatencyMsMedian: number | null;
  coordinationCoverage: number | null;
  resolutionAccuracy: number | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse an ISO timestamp string to a number (ms since epoch).
 * Returns NaN when the string is absent, empty, or unparseable.
 */
function parseMs(ts: string | null | undefined): number {
  if (!ts) return NaN;
  return Date.parse(ts);
}

/** Compute the median of a non-empty numeric array. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// KPI 1 — Autonomy Ratio
// ---------------------------------------------------------------------------

/**
 * The action name(s) that constitute an AGENT ESCALATION — i.e. the agent
 * raising an agent_blocker to hand a judgment call to a human. `flag_blocker`
 * is the only action in the ontology that writes an agent_blocker row, so it is
 * the sole escalation action. Exposed as a parameter (with this default) to
 * keep the function pure and testable without an ontology import.
 */
export const DEFAULT_ESCALATION_ACTIONS: readonly string[] = ["flag_blocker"];

/**
 * autonomyRatio — of the decisions the AGENT ITSELF initiated, what fraction it
 * handled UNAIDED (auto-applied) vs ESCALATED to a human.
 *
 * Definition (for grant report):
 *   We count only AGENT-INITIATED decisions. Purely human-initiated actions
 *   (always_confirm dispositions a steward drives — resolve_blocker_with_pathway,
 *   check_in/out, dismiss_blocker) are NOT in the denominator: a human deciding
 *   is not the agent acting.
 *
 *   escalated    = ok action-audit rows whose subject_id is an escalation action
 *                  (default: "flag_blocker"). Each is the agent handing a
 *                  judgment call to a human (it raises an agent_blocker).
 *   auto_applied = ok action-audit rows whose policyOf(subject_id) === "auto_apply"
 *                  and which are NOT an escalation action. Each is the agent
 *                  executing a decision unaided.
 *   Ratio        = auto_applied / (auto_applied + escalated),
 *                  or null when the denominator is 0 (no agent-initiated decisions).
 *
 *   Excluded entirely: result ≠ "ok" (error/pending/replay), subject_type ≠
 *   "action", always_confirm actions (human-initiated), and actions with no
 *   registered policy that are not escalation actions.
 */
export function autonomyRatio(
  audits: MetricAuditRow[],
  policyOf: PolicyOf,
  escalationActions: readonly string[] = DEFAULT_ESCALATION_ACTIONS
): number | null {
  const escalationSet = new Set(escalationActions);
  let autoApplied = 0;
  let escalated = 0;

  for (const row of audits) {
    if (row.subject_type !== "action") continue;
    if (row.metadata?.result !== "ok") continue;
    const name = row.subject_id ?? "";

    if (escalationSet.has(name)) {
      escalated += 1;
      continue;
    }
    if (policyOf(name) === "auto_apply") {
      autoApplied += 1;
    }
    // always_confirm and unknown-policy non-escalation actions are excluded:
    // they are human-initiated dispositions or not agent decisions.
  }

  const denominator = autoApplied + escalated;
  return denominator === 0 ? null : autoApplied / denominator;
}

// ---------------------------------------------------------------------------
// KPI 2 — Scenario Acceptance Rate
// ---------------------------------------------------------------------------

/**
 * scenarioAcceptanceRate — fraction of closed blockers that were accepted.
 *
 * Definition:
 *   Denominator = blockers with status ∈ {"resolved", "dismissed", "expired"}
 *                 (i.e., closed; "open" blockers are excluded — they have not
 *                 yet received a human decision).
 *   Numerator   = closed blockers with status === "resolved".
 *   Ratio       = numerator / denominator, or null when denominator === 0.
 *
 *   Meaning: of all situations that received a human decision, what fraction
 *   resulted in the agent's offered resolution pathway being accepted (vs
 *   dismissed or allowed to expire without action).
 */
export function scenarioAcceptanceRate(
  blockers: MetricBlockerRow[]
): number | null {
  const CLOSED = new Set(["resolved", "dismissed", "expired"]);
  let denominator = 0;
  let numerator = 0;

  for (const b of blockers) {
    if (!CLOSED.has(b.status)) continue;
    denominator += 1;
    if (b.status === "resolved") numerator += 1;
  }

  return denominator === 0 ? null : numerator / denominator;
}

// ---------------------------------------------------------------------------
// KPI 3 — Decision Latency Median (ms)
// ---------------------------------------------------------------------------

/**
 * decisionLatencyMsMedian — typical time from escalation to human decision.
 *
 * Definition:
 *   Eligible set = blockers with status === "resolved" AND both created_at
 *                  and resolved_at present, parseable (Date.parse not NaN),
 *                  and resolved_at ≥ created_at (negative durations are
 *                  treated as data errors and excluded).
 *   Value per row = Date.parse(resolved_at) − Date.parse(created_at), in ms.
 *   Result        = median of values across the eligible set (even-count
 *                   median = average of the two middle values), or null when
 *                   the eligible set is empty.
 *
 *   Meaning: the p50 latency (milliseconds) between an agent escalation and
 *   the moment a human resolves it.
 */
export function decisionLatencyMsMedian(
  blockers: MetricBlockerRow[]
): number | null {
  const latencies: number[] = [];

  for (const b of blockers) {
    if (b.status !== "resolved") continue;
    const created = parseMs(b.created_at);
    const resolved = parseMs(b.resolved_at);
    if (isNaN(created) || isNaN(resolved)) continue;
    if (resolved < created) continue;
    latencies.push(resolved - created);
  }

  return latencies.length === 0 ? null : median(latencies);
}

// ---------------------------------------------------------------------------
// KPI 4 — Coordination Coverage
// ---------------------------------------------------------------------------

/**
 * coordinationCoverage — fraction of detected situations that have been addressed.
 *
 * Definition:
 *   Denominator = all blockers (regardless of status).
 *   Numerator   = blockers with status ≠ "open" (i.e., closed in any way).
 *   Ratio       = numerator / denominator, or null when denominator === 0.
 *
 *   Meaning: what share of agent-raised escalations have received some form
 *   of human attention (resolved, dismissed, or expired) vs remaining pending.
 */
export function coordinationCoverage(
  blockers: MetricBlockerRow[]
): number | null {
  if (blockers.length === 0) return null;
  const closed = blockers.filter((b) => b.status !== "open").length;
  return closed / blockers.length;
}

// ---------------------------------------------------------------------------
// KPI 5 — Resolution Accuracy
// ---------------------------------------------------------------------------

/**
 * resolutionAccuracy — proxy for decision quality: resolutions that held.
 *
 * Definition:
 *   Eligible set = resolved blockers (status === "resolved") that have a
 *                  parseable resolved_at timestamp.
 *   A blocker is "re-flagged" if there exists ANY OTHER blocker in the full
 *   set with the SAME (blocked_actor_id, reason_kind, summary) triple whose
 *   created_at is strictly AFTER this blocker's resolved_at. A re-flag means
 *   the same situation re-surfaced after the resolution, implying the
 *   decision did not fully address it.
 *   Numerator   = eligible blockers that are NOT re-flagged.
 *   Denominator = size of the eligible set.
 *   Ratio       = numerator / denominator, or null when denominator === 0.
 *
 *   Comparison key: blockers sharing the same triple created BEFORE or AT the
 *   resolved_at are NOT treated as re-flags (they are contemporaneous context,
 *   not a recurrence).
 */
export function resolutionAccuracy(
  blockers: MetricBlockerRow[]
): number | null {
  // Build eligible resolved set
  type Eligible = {
    blocked_actor_id: string | null | undefined;
    reason_kind: string | null | undefined;
    summary: string | null | undefined;
    resolvedMs: number;
  };

  const eligible: Eligible[] = [];
  for (const b of blockers) {
    if (b.status !== "resolved") continue;
    const resolvedMs = parseMs(b.resolved_at);
    if (isNaN(resolvedMs)) continue;
    eligible.push({
      blocked_actor_id: b.blocked_actor_id,
      reason_kind: b.reason_kind,
      summary: b.summary,
      resolvedMs,
    });
  }

  if (eligible.length === 0) return null;

  // Pre-compute lookup: for each (actor, kind, summary) triple, collect all
  // created_at timestamps from the FULL blocker set (other entries).
  // We'll use string keys to avoid repeated comparisons.
  function tripleKey(
    actor: string | null | undefined,
    kind: string | null | undefined,
    sum: string | null | undefined
  ): string {
    return JSON.stringify([actor ?? null, kind ?? null, sum ?? null]);
  }

  const createdMsByTriple = new Map<string, number[]>();
  for (const b of blockers) {
    const key = tripleKey(b.blocked_actor_id, b.reason_kind, b.summary);
    const ms = parseMs(b.created_at);
    if (!isNaN(ms)) {
      const arr = createdMsByTriple.get(key) ?? [];
      arr.push(ms);
      createdMsByTriple.set(key, arr);
    }
  }

  let accurate = 0;
  for (const e of eligible) {
    const key = tripleKey(e.blocked_actor_id, e.reason_kind, e.summary);
    const allCreated = createdMsByTriple.get(key) ?? [];
    // Re-flagged = another blocker with same triple, created STRICTLY AFTER resolved_at.
    // Because the eligible blocker itself is in the full set, we need to check
    // if ANY of the created timestamps is strictly > resolvedMs.
    // The eligible blocker's own created_at (which is <= resolvedMs for a valid
    // resolved blocker) won't trigger this condition.
    const reFlagged = allCreated.some((createdMs) => createdMs > e.resolvedMs);
    if (!reFlagged) accurate += 1;
  }

  return accurate / eligible.length;
}

// ---------------------------------------------------------------------------
// Aggregate — computeCommunityIntelligence
// ---------------------------------------------------------------------------

/**
 * computeCommunityIntelligence — compute all five KPIs in one call.
 *
 * Returns a CommunityIntelligenceMetrics object where each field is either a
 * number in [0, 1] or null (no data). decisionLatencyMsMedian is in
 * milliseconds and may exceed 1 (it is a duration, not a ratio).
 */
export function computeCommunityIntelligence(
  blockers: MetricBlockerRow[],
  audits: MetricAuditRow[],
  policyOf: PolicyOf
): CommunityIntelligenceMetrics {
  return {
    autonomyRatio: autonomyRatio(audits, policyOf),
    scenarioAcceptanceRate: scenarioAcceptanceRate(blockers),
    decisionLatencyMsMedian: decisionLatencyMsMedian(blockers),
    coordinationCoverage: coordinationCoverage(blockers),
    resolutionAccuracy: resolutionAccuracy(blockers),
  };
}
