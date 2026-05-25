// lib/theme/css.ts
import { TOKEN_KEYS, type TokenSet } from "./tokens";
import type { CSSProperties } from "react";

// The token keys already match globals.css variable names (kebab), so the
// CSS var is just `--${key}`. Returned object is spread onto a style={} prop.
// Return type includes the index signature for CSS custom properties so
// callers can read vars["--foo"] without type assertions.
export function tokenSetToCssVars(tokens: TokenSet): CSSProperties & Record<`--${string}`, string> {
  const out: Record<string, string> = {};
  for (const k of TOKEN_KEYS) out[`--${k}`] = tokens[k];
  return out as CSSProperties & Record<`--${string}`, string>;
}
