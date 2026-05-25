// lib/theme/tokens.ts
//
// The governed theming vocabulary. The token KEYS (names/roles) are invariant —
// they mirror the CSS variables in app/globals.css. A "theme" is any valid
// TokenSet: the base palette here, or one an agent generates later (Phase 5).
// Only VALUES vary; structure never does.

export const TOKEN_KEYS = [
  "background", "foreground",
  "card", "card-foreground",
  "popover", "popover-foreground",
  "primary", "primary-foreground",
  "secondary", "secondary-foreground",
  "muted", "muted-foreground",
  "accent", "accent-foreground",
  "destructive",
  "border", "input", "ring",
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];
export type TokenSet = Record<TokenKey, string>;

// A fully-anchored oklch grammar: `oklch(L C H)` with an optional `/ alpha`.
// Anchoring both ends is the structural guardrail — a token VALUE can only be a
// complete color, never a color followed by injected CSS (`oklch(..);}…`). The
// agent has color freedom within this grammar; it cannot escape it.
export const OKLCH_RE = /^oklch\(\s*[0-9.]+%?\s+[0-9.]+\s+[0-9.]+(?:\s*\/\s*[0-9.]+%?)?\s*\)$/i;

export function isOklchString(value: unknown): value is string {
  return typeof value === "string" && OKLCH_RE.test(value.trim());
}

// The one base palette = the .dark token values already in globals.css :root/.dark.
// acropolisOS ships dark-first; these oklch values match the existing .dark block.
export const BASE_TOKENS: TokenSet = {
  background: "oklch(0.141 0.005 285.823)",
  foreground: "oklch(0.985 0 0)",
  card: "oklch(0.21 0.006 285.885)",
  "card-foreground": "oklch(0.985 0 0)",
  popover: "oklch(0.21 0.006 285.885)",
  "popover-foreground": "oklch(0.985 0 0)",
  primary: "oklch(0.62 0.19 280)",
  "primary-foreground": "oklch(0.985 0 0)",
  secondary: "oklch(0.274 0.006 286.033)",
  "secondary-foreground": "oklch(0.985 0 0)",
  muted: "oklch(0.274 0.006 286.033)",
  "muted-foreground": "oklch(0.705 0.015 286.067)",
  accent: "oklch(0.274 0.006 286.033)",
  "accent-foreground": "oklch(0.985 0 0)",
  destructive: "oklch(0.704 0.191 22.216)",
  border: "oklch(1 0 0 / 10%)",
  input: "oklch(1 0 0 / 15%)",
  ring: "oklch(0.552 0.016 285.938)",
};

export function isValidTokenSet(value: unknown): value is TokenSet {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  if (Object.keys(rec).length !== TOKEN_KEYS.length) return false;
  for (const k of TOKEN_KEYS) {
    if (!isOklchString(rec[k])) return false;
  }
  return true;
}

export function parseTokenSet(raw: string | null | undefined): TokenSet | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidTokenSet(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
