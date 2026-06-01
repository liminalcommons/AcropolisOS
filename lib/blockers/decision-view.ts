// Pure view-model for the Focus decision surface. Turns raw agent_blocker rows
// into the opinionated decision anatomy: framing + ≤3 safest-first scenarios
// (label · consequence · reversibility) + the learning trace. No I/O.
//
// THE OPINION: reversibility ordering (rankPathways) is authoritative — the
// `recommended` scenario is always the safest, and popularity can never promote
// a less-reversible option above a more-reversible one. The trace still surfaces
// what the community actually picks (transparency), kept separate from the
// safe-by-default ordering.
import {
  parsePathways,
  rankPathways,
  computePathwayPreference,
  pathwayIdentity,
  type Pathway,
} from "./pathway-preference";

export type ReversibilityTier = "easy" | "moderate" | "permanent";
export type ResolutionMode = "pathways" | "text_input" | "confirm_binary";

export interface DecisionInput {
  id: string;
  summary: string;
  detail?: string | null;
  reason_kind: string;
  status: string;
  created_at: string;
  blocked_actor_id?: string | null;
  resolution_mode?: string | null;
  pathways?: unknown;
  resolved_via_pathway_id?: string | null;
}

export interface DecisionScenario {
  id: string;
  label: string;
  consequence: string; // the pathway's rationale (what it does / costs)
  reversibility: ReversibilityTier;
  recommended: boolean; // the safest-first leader
}

export interface DecisionView {
  id: string;
  summary: string;
  detail: string;
  reasonKind: string;
  createdAt: string;
  blockedActorId: string | null;
  mode: ResolutionMode;
  scenarios: DecisionScenario[];
  /** "the community usually picks X (count/total)" — never reorders scenarios. */
  trace: { label: string; count: number; total: number } | null;
}

const MODES: ResolutionMode[] = ["pathways", "text_input", "confirm_binary"];
const TIERS: ReversibilityTier[] = ["easy", "moderate", "permanent"];

function asTier(r: string | undefined): ReversibilityTier {
  return r && (TIERS as string[]).includes(r) ? (r as ReversibilityTier) : "moderate";
}
function asMode(m: string | null | undefined): ResolutionMode {
  return m && (MODES as string[]).includes(m) ? (m as ResolutionMode) : "pathways";
}

/** Oldest-first (SLA): don't let escalated judgment calls rot. Stable, non-mutating. */
export function orderDecisionQueue<T extends { created_at: string }>(blockers: T[]): T[] {
  return blockers
    .map((b, index) => ({ b, index }))
    .sort((a, z) => {
      if (a.b.created_at !== z.b.created_at) return a.b.created_at < z.b.created_at ? -1 : 1;
      return a.index - z.index;
    })
    .map((x) => x.b);
}

export function buildDecisionView(blocker: DecisionInput, allBlockers: DecisionInput[]): DecisionView {
  const mode = asMode(blocker.resolution_mode);
  const preference = computePathwayPreference(
    allBlockers.map((b) => ({
      reason_kind: b.reason_kind,
      status: b.status,
      pathways: b.pathways,
      resolved_via_pathway_id: b.resolved_via_pathway_id ?? null,
    })),
    blocker.reason_kind,
  );

  const parsed: Pathway[] = mode === "pathways" ? parsePathways(blocker.pathways) : [];
  const ranked = rankPathways(parsed, preference);
  const scenarios: DecisionScenario[] = ranked.map((p, i) => ({
    id: p.id,
    label: p.label,
    consequence: typeof p.rationale === "string" ? p.rationale : "",
    reversibility: asTier(p.reversibility),
    recommended: i === 0,
  }));

  // Trace: the most-chosen identity for this reason_kind (transparency only).
  let trace: DecisionView["trace"] = null;
  if (preference.size > 0) {
    let topIdentity = "";
    let topCount = 0;
    let total = 0;
    for (const [identity, count] of preference) {
      total += count;
      if (count > topCount) {
        topCount = count;
        topIdentity = identity;
      }
    }
    // Prefer the human label of the winning identity (fall back to the identity itself).
    const match = parsed.find((p) => pathwayIdentity(p) === topIdentity);
    trace = { label: match?.label ?? topIdentity, count: topCount, total };
  }

  return {
    id: blocker.id,
    summary: blocker.summary,
    detail: blocker.detail ?? "",
    reasonKind: blocker.reason_kind,
    createdAt: blocker.created_at,
    blockedActorId: blocker.blocked_actor_id ?? null,
    mode,
    scenarios,
    trace,
  };
}
