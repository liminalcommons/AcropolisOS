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
  input_schema?: unknown; // text_input: { kind, prompt }
  confirm_action?: unknown; // confirm_binary: { label, action, reversibility? }
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
  /** text_input: the specific question the human should answer (null ⇒ generic label). */
  inputPrompt: string | null;
  /** confirm_binary: the single proposed action + its stakes (null ⇒ generic Resolve). */
  confirm: { label: string; reversibility: ReversibilityTier } | null;
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

/** Tolerant: a jsonb column comes back as either a parsed object or a JSON string. */
function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
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

  // text_input: the agent's specific question for the human (null ⇒ generic label).
  let inputPrompt: string | null = null;
  if (mode === "text_input") {
    const schema = parseJsonObject(blocker.input_schema);
    inputPrompt = schema && typeof schema.prompt === "string" ? schema.prompt : null;
  }

  // confirm_binary: the single proposed action + its reversibility stakes.
  let confirm: DecisionView["confirm"] = null;
  if (mode === "confirm_binary") {
    const ca = parseJsonObject(blocker.confirm_action);
    if (ca && typeof ca.label === "string") {
      confirm = {
        label: ca.label,
        reversibility: asTier(typeof ca.reversibility === "string" ? ca.reversibility : undefined),
      };
    }
  }

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
    inputPrompt,
    confirm,
    trace,
  };
}

/**
 * Seed text for the "Discuss with the agent" affordance — the deep-link that
 * opens the chat scoped to THIS decision so the human can interrogate it before
 * disposing it. Pure: turns a DecisionView into a first message that hands the
 * agent the decision's framing + whatever options it already offered, and asks
 * for advice WITHOUT taking action (discussion, not disposition). The composer
 * is pre-filled (not auto-sent) so the human edits before sending.
 */
export function buildDiscussPrompt(d: DecisionView): string {
  const lines = [
    "I want to talk through a decision you escalated to me before I act on it.",
    `Decision: ${d.summary}`,
  ];
  if (d.detail) lines.push(`Context you gave: ${d.detail}`);
  if (d.scenarios.length > 0) {
    lines.push(`The paths you offered: ${d.scenarios.map((s) => s.label).join("; ")}.`);
  } else if (d.confirm) {
    lines.push(`You proposed: ${d.confirm.label}.`);
  } else if (d.inputPrompt) {
    lines.push(`You asked: ${d.inputPrompt}`);
  }
  lines.push(
    "Walk me through the trade-offs and tell me what you'd recommend and why — but don't take any action yet.",
  );
  return lines.join("\n");
}
