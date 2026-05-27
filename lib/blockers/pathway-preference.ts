// Pure helpers for ranking AgentBlocker pathways by accumulated human choices.
// No DB, no I/O — safe to import anywhere including tests and client code.

export type Pathway = {
  id: string;
  label: string;
  rationale?: string;
  action?: { type?: string; params?: unknown };
  reversibility?: string;
};

export type BlockerRow = {
  reason_kind: string;
  status: string;
  pathways?: unknown;
  resolved_via_pathway_id?: string | null;
};

/**
 * Safely parse a pathways value that may arrive as a JSON string, a parsed
 * array, or null/undefined (the DB column is jsonb so reads may skip
 * deserialization; the write path does JSON.stringify). Returns [] on any
 * invalid input.
 */
export function parsePathways(value: unknown): Pathway[] {
  if (value === null || value === undefined) return [];

  let candidate: unknown = value;

  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(candidate)) return [];

  // Validate: every element must be an object with a non-empty string id.
  const valid = candidate.filter(
    (item): item is Pathway =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).id === "string" &&
      (item as Record<string, unknown>).id !== "",
  );

  // If none survived validation (e.g. array of primitives), return [].
  return valid;
}

/**
 * Returns the semantic identity of a pathway for preference tallying.
 * Prefers action.type (captures WHAT the agent will do) over label
 * (human-readable, may vary across blocker rows for the same logical choice).
 */
export function pathwayIdentity(p: Pathway): string {
  const actionType = p.action?.type;
  if (typeof actionType === "string" && actionType.length > 0) return actionType;
  return p.label;
}

/**
 * Tallies how often each semantic pathway identity was chosen by humans,
 * filtered to resolved rows matching `reasonKind`. Returns a Map of
 * identity → count. Rows where resolved_via_pathway_id does not match any
 * parsed pathway are silently ignored (data integrity gap, not an error).
 */
export function computePathwayPreference(
  rows: BlockerRow[],
  reasonKind: string,
): Map<string, number> {
  const tally = new Map<string, number>();

  for (const row of rows) {
    if (row.status !== "resolved") continue;
    if (row.reason_kind !== reasonKind) continue;
    if (!row.resolved_via_pathway_id) continue;

    const pathways = parsePathways(row.pathways);
    const chosen = pathways.find((p) => p.id === row.resolved_via_pathway_id);
    if (!chosen) continue;

    const identity = pathwayIdentity(chosen);
    tally.set(identity, (tally.get(identity) ?? 0) + 1);
  }

  return tally;
}

// Safety ordering for the reversibility of an action: a more-reversible action
// is always safer to surface first. Lower rank = safer = ranked earlier.
const REVERSIBILITY_RANK: Record<string, number> = {
  easy: 0,
  moderate: 1,
  permanent: 2,
};

/**
 * Reversibility tier of a pathway. Unknown/missing reversibility maps to
 * "moderate" (1): a neutral middle that neither promotes an un-annotated
 * pathway to the top nor buries it below annotated reversible ones.
 */
function reversibilityRank(p: Pathway): number {
  const r = p.reversibility;
  if (typeof r === "string" && r in REVERSIBILITY_RANK) return REVERSIBILITY_RANK[r];
  return 1;
}

/**
 * Returns a NEW array of pathways ranked SAFEST-FIRST, then by accumulated
 * human preference within each safety tier. Sort keys, in order:
 *   1. reversibility tier ASC (easy < moderate < permanent) — popularity can
 *      NEVER surface a less-reversible action above a more-reversible one;
 *      self-correction must not erode safe-by-default ordering.
 *   2. preference count DESC (identity not in the map = 0).
 *   3. original index ASC — preserves the agent's order for full ties (stable).
 * Input is not mutated.
 */
export function rankPathways(
  pathways: Pathway[],
  preference: Map<string, number>,
): Pathway[] {
  return pathways
    .map((p, index) => ({ p, index }))
    .sort((a, b) => {
      const revA = reversibilityRank(a.p);
      const revB = reversibilityRank(b.p);
      if (revA !== revB) return revA - revB;
      const countA = preference.get(pathwayIdentity(a.p)) ?? 0;
      const countB = preference.get(pathwayIdentity(b.p)) ?? 0;
      if (countA !== countB) return countB - countA;
      return a.index - b.index;
    })
    .map((x) => x.p);
}
