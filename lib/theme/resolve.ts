// lib/theme/resolve.ts
//
// Precedence: explicit member pref → per-role default → data-derived seed → base.
// Phase 3 ships only the base palette, so role/orgSeed currently resolve to
// BASE_TOKENS; the seams exist for Phase 5 without changing callers.

import { BASE_TOKENS, parseTokenSet, type TokenSet } from "./tokens";

export interface ThemeInputs {
  memberPref: string | null | undefined;
  role: string | null | undefined;
  orgSeed: string | null | undefined;
}

function roleDefault(_role: string | null | undefined): TokenSet {
  return BASE_TOKENS;
}

function seedToTokens(_seed: string | null | undefined): TokenSet | null {
  return null;
}

export function resolveTheme(inputs: ThemeInputs): TokenSet {
  const explicit = parseTokenSet(inputs.memberPref);
  if (explicit) return explicit;
  const seeded = seedToTokens(inputs.orgSeed);
  if (seeded) return seeded;
  return roleDefault(inputs.role);
}
