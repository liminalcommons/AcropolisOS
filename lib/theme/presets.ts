// Curated theme presets — the user picks one rather than prompting. Each is a
// complete, contrast-validated TokenSet (see lib/theme/presets.test.ts). "Warm
// Earthy" is the default and reuses BASE_TOKENS so the swatch always equals the
// actual floor. The token SCHEMA stays the invariant governance; presets only
// supply values within it.
import { BASE_TOKENS, type TokenSet } from "./tokens";

export interface ThemePreset {
  id: string;
  name: string;
  tokens: TokenSet;
}

export const DEFAULT_PRESET_ID = "warm-earthy";

export const THEME_PRESETS: ThemePreset[] = [
  { id: "warm-earthy", name: "Warm Earthy", tokens: BASE_TOKENS },
  {
    id: "oceanic",
    name: "Oceanic",
    tokens: {
      background: "oklch(0.17 0.02 240)",
      foreground: "oklch(0.95 0.008 245)",
      card: "oklch(0.22 0.02 235)",
      "card-foreground": "oklch(0.95 0.008 245)",
      popover: "oklch(0.22 0.02 235)",
      "popover-foreground": "oklch(0.95 0.008 245)",
      primary: "oklch(0.66 0.13 210)",
      "primary-foreground": "oklch(0.2 0.02 210)",
      secondary: "oklch(0.3 0.022 235)",
      "secondary-foreground": "oklch(0.95 0.008 245)",
      muted: "oklch(0.3 0.022 235)",
      "muted-foreground": "oklch(0.76 0.03 230)",
      accent: "oklch(0.34 0.04 235)",
      "accent-foreground": "oklch(0.95 0.008 245)",
      destructive: "oklch(0.62 0.2 25)",
      border: "oklch(0.95 0.02 245 / 12%)",
      input: "oklch(0.95 0.02 245 / 16%)",
      ring: "oklch(0.66 0.12 210)",
    },
  },
  {
    id: "forest",
    name: "Forest",
    tokens: {
      background: "oklch(0.17 0.018 150)",
      foreground: "oklch(0.95 0.012 130)",
      card: "oklch(0.22 0.02 152)",
      "card-foreground": "oklch(0.95 0.012 130)",
      popover: "oklch(0.22 0.02 152)",
      "popover-foreground": "oklch(0.95 0.012 130)",
      primary: "oklch(0.66 0.13 155)",
      "primary-foreground": "oklch(0.2 0.02 155)",
      secondary: "oklch(0.3 0.022 152)",
      "secondary-foreground": "oklch(0.95 0.012 130)",
      muted: "oklch(0.3 0.022 152)",
      "muted-foreground": "oklch(0.76 0.03 145)",
      accent: "oklch(0.34 0.04 152)",
      "accent-foreground": "oklch(0.95 0.012 130)",
      destructive: "oklch(0.62 0.2 28)",
      border: "oklch(0.95 0.02 130 / 12%)",
      input: "oklch(0.95 0.02 130 / 16%)",
      ring: "oklch(0.66 0.12 155)",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    tokens: {
      background: "oklch(0.17 0.016 280)",
      foreground: "oklch(0.95 0.006 286)",
      card: "oklch(0.22 0.02 282)",
      "card-foreground": "oklch(0.95 0.006 286)",
      popover: "oklch(0.22 0.02 282)",
      "popover-foreground": "oklch(0.95 0.006 286)",
      primary: "oklch(0.66 0.15 275)",
      "primary-foreground": "oklch(0.2 0.02 275)",
      secondary: "oklch(0.3 0.022 282)",
      "secondary-foreground": "oklch(0.95 0.006 286)",
      muted: "oklch(0.3 0.022 282)",
      "muted-foreground": "oklch(0.76 0.03 286)",
      accent: "oklch(0.34 0.04 282)",
      "accent-foreground": "oklch(0.95 0.006 286)",
      destructive: "oklch(0.62 0.2 22)",
      border: "oklch(0.95 0.02 286 / 12%)",
      input: "oklch(0.95 0.02 286 / 16%)",
      ring: "oklch(0.66 0.12 275)",
    },
  },
  {
    id: "rosewood",
    name: "Rosewood",
    tokens: {
      background: "oklch(0.17 0.018 12)",
      foreground: "oklch(0.95 0.012 20)",
      card: "oklch(0.22 0.02 10)",
      "card-foreground": "oklch(0.95 0.012 20)",
      popover: "oklch(0.22 0.02 10)",
      "popover-foreground": "oklch(0.95 0.012 20)",
      primary: "oklch(0.66 0.14 8)",
      "primary-foreground": "oklch(0.2 0.02 8)",
      secondary: "oklch(0.3 0.022 10)",
      "secondary-foreground": "oklch(0.95 0.012 20)",
      muted: "oklch(0.3 0.022 10)",
      "muted-foreground": "oklch(0.76 0.03 20)",
      accent: "oklch(0.34 0.04 10)",
      "accent-foreground": "oklch(0.95 0.012 20)",
      destructive: "oklch(0.62 0.2 25)",
      border: "oklch(0.95 0.02 20 / 12%)",
      input: "oklch(0.95 0.02 20 / 16%)",
      ring: "oklch(0.66 0.12 8)",
    },
  },
  {
    id: "slate",
    name: "Slate",
    tokens: {
      background: "oklch(0.17 0.008 250)",
      foreground: "oklch(0.95 0.004 250)",
      card: "oklch(0.22 0.01 250)",
      "card-foreground": "oklch(0.95 0.004 250)",
      popover: "oklch(0.22 0.01 250)",
      "popover-foreground": "oklch(0.95 0.004 250)",
      primary: "oklch(0.66 0.05 250)",
      "primary-foreground": "oklch(0.2 0.02 250)",
      secondary: "oklch(0.3 0.012 250)",
      "secondary-foreground": "oklch(0.95 0.004 250)",
      muted: "oklch(0.3 0.012 250)",
      "muted-foreground": "oklch(0.76 0.012 250)",
      accent: "oklch(0.34 0.03 250)",
      "accent-foreground": "oklch(0.95 0.004 250)",
      destructive: "oklch(0.62 0.2 25)",
      border: "oklch(0.95 0.02 250 / 12%)",
      input: "oklch(0.95 0.02 250 / 16%)",
      ring: "oklch(0.66 0.05 250)",
    },
  },
];
