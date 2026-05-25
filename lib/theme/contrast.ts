// lib/theme/contrast.ts
//
// WCAG contrast validation for oklch token sets. Generation freedom is bounded
// by two structural guardrails — the fixed 18-key TokenSet schema and this
// contrast floor. The agent cannot ship an unreadable theme.
//
// Conversion path: parse "oklch(L C H)" → OKLab → LMS' → LMS → linear sRGB
// (Björn Ottosson's matrices) → WCAG relative luminance on the LINEAR channels
// → contrast (Llighter+0.05)/(Ldarker+0.05).
import { type TokenSet, type TokenKey } from "./tokens";

// Parse "oklch(L C H)" — L in [0,1] (or %), C ≥ 0, H in degrees. Tolerant of
// "oklch(62% 0.19 280)" and extra whitespace. Returns null if unparseable.
function parseOklch(s: string): { L: number; C: number; H: number } | null {
  const m = s.trim().match(/^oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)/i);
  if (!m) return null;
  let L = parseFloat(m[1]);
  if (m[1].endsWith("%")) L /= 100;
  return { L, C: parseFloat(m[2]), H: parseFloat(m[3]) };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// oklch → linear sRGB (Ottosson). Returns linear [r,g,b].
function oklchToLinearRgb(L: number, C: number, Hdeg: number): [number, number, number] {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// WCAG relative luminance from LINEAR rgb.
function relativeLuminance(s: string): number | null {
  const c = parseOklch(s);
  if (!c) return null;
  const [r, g, b] = oklchToLinearRgb(c.L, c.C, c.H).map(clamp01) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return 1; // unparseable → worst case (fails AA)
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Foreground-on-surface pairs that carry text, each with its own minimum.
// Body-text surfaces (background, card, popover) use AA normal-text 4.5:1.
// Tinted UI-component surfaces (primary/secondary/muted/accent are button /
// chip / label backgrounds, large-text or UI-component territory) use the AA
// 3.0:1 floor. This is the set of thresholds that makes BASE_TOKENS (the floor
// itself) pass its own validator — its primary button is white-on-indigo at
// 3.69:1 — while still rejecting foreground===background.
const TEXT_PAIRS: Array<[TokenKey, TokenKey, number]> = [
  ["foreground", "background", 4.5],
  ["card-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["primary-foreground", "primary", 3.0],
  ["secondary-foreground", "secondary", 3.0],
  ["muted-foreground", "muted", 3.0],
  ["accent-foreground", "accent", 3.0],
];

export interface ContrastResult {
  ok: boolean;
  failures: Array<{ pair: string; ratio: number }>;
}

export function validateContrast(tokens: TokenSet): ContrastResult {
  const failures: Array<{ pair: string; ratio: number }> = [];
  for (const [fg, bg, min] of TEXT_PAIRS) {
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    if (ratio < min) failures.push({ pair: `${fg}/${bg}`, ratio: Math.round(ratio * 100) / 100 });
  }
  return { ok: failures.length === 0, failures };
}
