// lib/theme/design.ts
//
// designTheme() core — the senior-color-expert agent. Builds a persona prompt,
// calls an injected `generate` fn (default generateText with buildLanguageModel),
// extracts JSON from the (possibly fenced/prosey) text, zod-validates against the
// exact 18-key TokenSet schema, contrast-validates (WCAG floor), retries once,
// then errors. Mirrors app/api/organize/classify/route.ts's text-path pattern.
//
// Generation freedom is bounded by two structural guardrails: the fixed schema
// (zod .strict() — no extra/missing keys) and the contrast floor. The agent
// chooses VALUES within a governed vocabulary; it cannot alter structure or
// ship an unreadable theme.
import { z } from "zod";
import { generateText } from "ai";
import { buildLanguageModel } from "@/lib/agent/mastra";
import { extractJson } from "@/lib/agent/extract-json";
import { validateContrast } from "./contrast";
import { TOKEN_KEYS, type TokenSet } from "./tokens";

export interface DesignThemeInput {
  prompt?: string;
  dataContext?: string;
}
export type DesignThemeResult =
  | { status: "ok"; tokens: TokenSet }
  | { status: "error"; reason: string };

export interface DesignDeps {
  generate: (system: string, prompt: string) => Promise<string>;
}

const oklchString = z
  .string()
  .regex(/^oklch\(/i, "must be an oklch(...) color string");

// Exact 18-key TokenSet schema. Listed literally (mirrors TOKEN_KEYS) so tsc is
// happy and no extra/missing key can slip through (.strict()).
const TokenSetSchema = z
  .object({
    background: oklchString,
    foreground: oklchString,
    card: oklchString,
    "card-foreground": oklchString,
    popover: oklchString,
    "popover-foreground": oklchString,
    primary: oklchString,
    "primary-foreground": oklchString,
    secondary: oklchString,
    "secondary-foreground": oklchString,
    muted: oklchString,
    "muted-foreground": oklchString,
    accent: oklchString,
    "accent-foreground": oklchString,
    destructive: oklchString,
    border: oklchString,
    input: oklchString,
    ring: oklchString,
  })
  .strict();

const SYSTEM = `You are a world-class senior UI designer and color expert specializing in interface aesthetics, color theory, and accessibility. You design cohesive dark-first UI color palettes.

You will be given a desired look (and optionally some context about the product's data domain). Produce a COMPLETE color palette as a single JSON object with EXACTLY these ${TOKEN_KEYS.length} keys, each an oklch() color string:
${TOKEN_KEYS.map((k) => `"${k}"`).join(", ")}.

Rules:
- Every value MUST be a valid CSS oklch() string, e.g. "oklch(0.62 0.19 280)".
- *-foreground colors MUST have strong contrast against their matching surface (foreground vs background, card-foreground vs card, primary-foreground vs primary, etc.) — aim for WCAG AA (4.5:1) on text pairs.
- Keep the palette cohesive (shared hue family / harmonious accents), dark-first unless the user explicitly asks for light.
- Output ONLY the JSON object. No prose, no markdown fences.`;

function buildUserPrompt(input: DesignThemeInput): string {
  const parts: string[] = [];
  parts.push(`Desired look: ${input.prompt?.trim() || "a refined, professional dark theme"}`);
  if (input.dataContext?.trim()) parts.push(`Product/data context: ${input.dataContext.trim()}`);
  return parts.join("\n");
}

const MAX_ATTEMPTS = 2;

export async function designTheme(
  input: DesignThemeInput,
  deps?: Partial<DesignDeps>,
): Promise<DesignThemeResult> {
  const generate: DesignDeps["generate"] =
    deps?.generate ??
    (async (system, prompt) => {
      const r = await generateText({ model: buildLanguageModel(), system, prompt });
      return r.text;
    });

  const userPrompt = buildUserPrompt(input);
  let lastReason = "unknown_error";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let text: string;
    try {
      text = await generate(SYSTEM, userPrompt);
    } catch {
      lastReason = "llm_unavailable";
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      lastReason = "parse_error";
      continue;
    }

    const validated = TokenSetSchema.safeParse(parsed);
    if (!validated.success) {
      lastReason = "schema_error";
      continue;
    }

    const tokens = validated.data as TokenSet;
    const contrast = validateContrast(tokens);
    if (!contrast.ok) {
      lastReason = `contrast_failed: ${contrast.failures.map((f) => f.pair).join(", ")}`;
      continue;
    }

    return { status: "ok", tokens };
  }

  return { status: "error", reason: lastReason };
}
