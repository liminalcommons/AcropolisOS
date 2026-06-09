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
  "destructive", "destructive-foreground",
  "success", "success-foreground",
  "warning", "warning-foreground",
  "info", "info-foreground",
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

// The one base palette = the .dark token values in globals.css. acropolisOS ships
// dark-first with a WARM EARTHY default: dark soil backgrounds, warm cream text,
// terracotta/clay primary. These values match the .dark block and pass the WCAG
// contrast validator (see lib/theme/contrast.ts).
export const BASE_TOKENS: TokenSet = {
  background: "oklch(0.17 0.012 55)",
  foreground: "oklch(0.95 0.012 85)",
  card: "oklch(0.22 0.016 52)",
  "card-foreground": "oklch(0.95 0.012 85)",
  popover: "oklch(0.22 0.016 52)",
  "popover-foreground": "oklch(0.95 0.012 85)",
  primary: "oklch(0.66 0.14 55)",
  "primary-foreground": "oklch(0.2 0.02 50)",
  secondary: "oklch(0.3 0.022 58)",
  "secondary-foreground": "oklch(0.95 0.012 85)",
  muted: "oklch(0.3 0.022 58)",
  "muted-foreground": "oklch(0.76 0.03 75)",
  accent: "oklch(0.34 0.04 58)",
  "accent-foreground": "oklch(0.95 0.012 85)",
  destructive: "oklch(0.62 0.2 28)",
  "destructive-foreground": "oklch(0.2 0.02 28)",
  success: "oklch(0.66 0.15 150)",
  "success-foreground": "oklch(0.2 0.02 150)",
  warning: "oklch(0.74 0.15 75)",
  "warning-foreground": "oklch(0.2 0.02 75)",
  info: "oklch(0.66 0.13 235)",
  "info-foreground": "oklch(0.2 0.02 235)",
  border: "oklch(0.95 0.02 80 / 12%)",
  input: "oklch(0.95 0.02 80 / 16%)",
  ring: "oklch(0.66 0.12 55)",
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
