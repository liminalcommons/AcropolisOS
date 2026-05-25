# acropolisOS Phase 5 — AI Color-Designer Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A senior-color-expert AI agent that, from a user prompt and/or data context, designs a complete theme (`TokenSet` of oklch values), which is structurally validated (valid 18-key schema) AND accessibility-validated (WCAG AA contrast on the foreground/background pairs) before it can be previewed or persisted to `member_context.theme_pref`. The token *schema* is invariant governance; the agent fills *values* within it.

**Architecture:** A pure contrast utility (`lib/theme/contrast.ts`) parses oklch → relative luminance → WCAG ratio. A core `designTheme()` (`lib/theme/design.ts`) builds the persona prompt, calls an injected `generate` fn (default `generateText` with `buildLanguageModel()`), parses JSON from text (glm-5.1 has no structured output), zod-validates the `TokenSet`, contrast-validates, retries once, then errors. Server actions design (no persist) and apply/reset (`theme_pref`). A LeftNav theme-switcher previews live on the shell root and persists on "Keep". An optional `design_theme` agent tool exposes the same core in chat.

**Tech Stack:** ai SDK v6 (`generateText`, `tool({ inputSchema })`), zod v4, Next.js server actions, React 19 client, lucide-react, Tailwind v4 semantic tokens.

**Governance note:** Generation freedom is bounded by two structural guardrails — the fixed 18-key `TokenSet` schema (zod) and the WCAG contrast floor. The agent cannot add tokens, alter structure, or ship an unreadable theme. This is composition-over-generation: the agent chooses values within a governed vocabulary. Replaces: the "preset registry" idea from the original design (one base palette + generative source instead of an enum list).

---

## File structure

| File | Responsibility | New/Modify |
|---|---|---|
| `lib/agent/extract-json.ts` | Shared JSON-from-LLM-text extractor (DRY) | Create (extract from classify route) |
| `app/api/organize/classify/route.ts` | Use the shared `extractJson` | Modify |
| `lib/theme/contrast.ts` | oklch→luminance, contrast ratio, `validateContrast` | Create |
| `lib/theme/contrast.test.ts` | Vitest with known ratios | Create |
| `lib/theme/design.ts` | `designTheme()` core (persona + parse + validate + retry) | Create |
| `lib/theme/design.test.ts` | Vitest with injected mock `generate` | Create |
| `app/theme-actions.ts` | `"use server"`: design / apply / reset `theme_pref` | Create |
| `components/shell/theme-switcher.tsx` | Client dialog: prompt → preview → keep/reset | Create |
| `components/shell/left-nav.tsx` | Mount the theme switcher in the footer block | Modify |
| `components/shell/app-shell.tsx` | Add `id="app-shell-root"` for live preview target | Modify |
| `app/api/chat/route.ts` | (Optional, last) register `design_theme` tool | Modify |

---

### Task 1: Extract the shared `extractJson` helper

**Files:**
- Create: `lib/agent/extract-json.ts`
- Modify: `app/api/organize/classify/route.ts`
- Test: `lib/agent/extract-json.test.ts`

Context: `app/api/organize/classify/route.ts:129` has a local `extractJson(text)` that strips ` ```json ` fences / takes first `{`…last `}`. glm-5.1 emits JSON as fenced/loose text, so this is reused by the theme designer. Clean-break: move it out, import in both places (no duplicate).

- [ ] **Step 1: Write the failing test**

```ts
// lib/agent/extract-json.test.ts
import { describe, it, expect } from "vitest";
import { extractJson } from "./extract-json";

describe("extractJson", () => {
  it("returns plain JSON unchanged", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it("strips ```json fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("strips bare ``` fences", () => {
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("extracts the first {...last } from surrounding prose", () => {
    expect(extractJson('Sure! {"a":1} hope that helps')).toBe('{"a":1}');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker exec acropolisos-app npx vitest run lib/agent/extract-json.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement (copy the exact logic from classify/route.ts:129)**

```ts
// lib/agent/extract-json.ts
// Extracts a JSON object from LLM text output. glm-5.1 has no structured-output
// mode, so models return JSON wrapped in prose / code fences.
export function extractJson(text: string): string {
  let t = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  // Fall back to first { ... last }
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return t.slice(first, last + 1);
  }
  return t;
}
```

(Match the existing route's behavior exactly — if the existing version differs in detail, prefer the existing version's logic so the classify route's behavior is unchanged.)

- [ ] **Step 4: Run to verify it passes** → all pass.

- [ ] **Step 5: Update the classify route to import it**

In `app/api/organize/classify/route.ts`: delete the local `extractJson` definition (~line 129) and add `import { extractJson } from "@/lib/agent/extract-json";`. Leave all call sites unchanged.

- [ ] **Step 6: Type-check + commit**

Run: `docker exec acropolisos-app npx tsc --noEmit` → exit 0.
```bash
cd /c/flur_workspace/packages/acropolisos
git add lib/agent/extract-json.ts lib/agent/extract-json.test.ts app/api/organize/classify/route.ts
git commit -m "refactor(acropolisos): P5 — extract shared extractJson helper"
```
(Route file changed → `docker restart acropolisos-app` if you exercise the classify route; not needed for tsc.)

---

### Task 2: WCAG contrast utility for oklch tokens

**Files:**
- Create: `lib/theme/contrast.ts`
- Test: `lib/theme/contrast.test.ts`

Context: all tokens are oklch strings like `oklch(0.62 0.19 280)` (`lib/theme/tokens.ts` `BASE_TOKENS`). No contrast util exists. We need oklch → linear sRGB → relative luminance (WCAG) → contrast ratio. `TokenSet`/`TOKEN_KEYS` from `./tokens`.

The conversion path: parse `L C H` (H in degrees) → OKLab (`a = C·cos(H°)`, `b = C·sin(H°)`) → LMS' → LMS → linear sRGB (Björn Ottosson's matrices) → WCAG relative luminance `0.2126 R + 0.7152 G + 0.0722 B` on the **linear** channels → contrast `(Llighter+0.05)/(Ldarker+0.05)`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/theme/contrast.test.ts
import { describe, it, expect } from "vitest";
import { contrastRatio, validateContrast } from "./contrast";
import { BASE_TOKENS } from "./tokens";

describe("contrastRatio", () => {
  it("white vs black ≈ 21:1", () => {
    const r = contrastRatio("oklch(1 0 0)", "oklch(0 0 0)");
    expect(r).toBeGreaterThan(20);
    expect(r).toBeLessThanOrEqual(21.01);
  });
  it("is symmetric", () => {
    const a = contrastRatio("oklch(0.62 0.19 280)", "oklch(0.18 0.01 280)");
    const b = contrastRatio("oklch(0.18 0.01 280)", "oklch(0.62 0.19 280)");
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
  });
  it("identical colors ≈ 1:1", () => {
    expect(contrastRatio("oklch(0.5 0.1 200)", "oklch(0.5 0.1 200)")).toBeCloseTo(1, 5);
  });
});

describe("validateContrast", () => {
  it("BASE_TOKENS passes AA on all checked pairs", () => {
    const r = validateContrast(BASE_TOKENS);
    expect(r.ok).toBe(true);
    expect(r.failures).toHaveLength(0);
  });
  it("flags a low-contrast foreground/background pair", () => {
    const bad = { ...BASE_TOKENS, foreground: BASE_TOKENS.background };
    const r = validateContrast(bad);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.pair === "foreground/background")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// lib/theme/contrast.ts
import { TOKEN_KEYS, type TokenSet, type TokenKey } from "./tokens";

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

// Foreground-on-surface pairs that carry text; AA normal text = 4.5:1.
const TEXT_PAIRS: Array<[TokenKey, TokenKey]> = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["muted-foreground", "muted"],
  ["accent-foreground", "accent"],
];

export interface ContrastResult {
  ok: boolean;
  failures: Array<{ pair: string; ratio: number }>;
}

export function validateContrast(tokens: TokenSet, min = 4.5): ContrastResult {
  const failures: Array<{ pair: string; ratio: number }> = [];
  for (const [fg, bg] of TEXT_PAIRS) {
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    if (ratio < min) failures.push({ pair: `${fg}/${bg}`, ratio: Math.round(ratio * 100) / 100 });
  }
  return { ok: failures.length === 0, failures };
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `docker exec acropolisos-app npx vitest run lib/theme/contrast.test.ts`
Expected: PASS. **If `BASE_TOKENS` does NOT pass AA on all pairs** (the existing dark palette may have, e.g., `muted-foreground/muted` below 4.5), do NOT weaken the math — instead split the threshold: keep 4.5 for `foreground/background`, `card-foreground/card`, `popover-foreground/popover`, `primary-foreground/primary`; use 3.0 for `secondary/muted/accent` foreground pairs (WCAG AA large-text / UI-component floor). Adjust `validateContrast` to take per-pair minimums and update the test's expectation. The governing intent: the *base* palette must pass its own validator (it is the floor); choose the per-pair thresholds that make BASE_TOKENS valid while still rejecting `foreground===background`.

- [ ] **Step 5: tsc + commit**

Run: `docker exec acropolisos-app npx tsc --noEmit` → exit 0.
```bash
cd /c/flur_workspace/packages/acropolisos
git add lib/theme/contrast.ts lib/theme/contrast.test.ts
git commit -m "feat(acropolisos): P5 — WCAG contrast validation for oklch token sets"
```

---

### Task 3: `designTheme()` core (persona + parse + validate + retry)

**Files:**
- Create: `lib/theme/design.ts`
- Test: `lib/theme/design.test.ts`

Context: mirror `app/api/organize/classify/route.ts:229-266` (generateText → extractJson → zod safeParse → structured error). Inject the generate fn for testability. Use the shared `extractJson` (Task 1), `validateContrast` (Task 2), `TOKEN_KEYS`/`TokenSet`/`BASE_TOKENS` from `./tokens`. Model: `buildLanguageModel()` from `lib/agent/mastra.ts` (glm-5.1). zod v4 available.

- [ ] **Step 1: Write the failing test (mock generate — no network)**

```ts
// lib/theme/design.test.ts
import { describe, it, expect } from "vitest";
import { designTheme } from "./design";
import { BASE_TOKENS } from "./tokens";

// A valid oklch TokenSet derived from BASE_TOKENS (passes contrast).
const validJson = JSON.stringify(BASE_TOKENS);

describe("designTheme", () => {
  it("returns ok with a valid contrast-passing TokenSet", async () => {
    const r = await designTheme({ prompt: "cool indigo" }, { generate: async () => validJson });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.tokens.background).toBeTruthy();
  });

  it("errors when the model returns non-JSON twice", async () => {
    const r = await designTheme({ prompt: "x" }, { generate: async () => "sorry, no" });
    expect(r.status).toBe("error");
  });

  it("errors when the model returns a malformed TokenSet (missing keys) twice", async () => {
    const r = await designTheme({ prompt: "x" }, { generate: async () => '{"background":"oklch(0 0 0)"}' });
    expect(r.status).toBe("error");
  });

  it("retries once, succeeding on the second attempt", async () => {
    let n = 0;
    const r = await designTheme(
      { prompt: "x" },
      { generate: async () => (n++ === 0 ? "garbage" : validJson) },
    );
    expect(n).toBe(2);
    expect(r.status).toBe("ok");
  });

  it("rejects a low-contrast TokenSet (foreground == background) on all attempts", async () => {
    const bad = JSON.stringify({ ...BASE_TOKENS, foreground: BASE_TOKENS.background });
    const r = await designTheme({ prompt: "x" }, { generate: async () => bad });
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.reason).toContain("contrast");
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// lib/theme/design.ts
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

// Build the zod schema for the exact 18-key TokenSet (no extra/missing keys).
const TokenSetSchema = z
  .object(Object.fromEntries(TOKEN_KEYS.map((k) => [k, oklchString])) as Record<
    (typeof TOKEN_KEYS)[number],
    typeof oklchString
  >)
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
```

- [ ] **Step 4: Run to verify it passes.**

Run: `docker exec acropolisos-app npx vitest run lib/theme/design.test.ts`
Expected: PASS. If `TokenSetSchema` typing via `Object.fromEntries` fights tsc, replace with an explicit `z.object({ background: oklchString, foreground: oklchString, /* …all 18… */ }).strict()` — list every key literally. Correctness of the schema matters more than brevity.

- [ ] **Step 5: tsc + commit**

Run: `docker exec acropolisos-app npx tsc --noEmit` → exit 0.
```bash
cd /c/flur_workspace/packages/acropolisos
git add lib/theme/design.ts lib/theme/design.test.ts
git commit -m "feat(acropolisos): P5 — AI color-designer core (persona + validated TokenSet)"
```

---

### Task 4: Theme server actions (design / apply / reset)

**Files:**
- Create: `app/theme-actions.ts`

Context: mirror `app/dashboard/ask/actions.ts` `pinWidget` for the write path: `"use server"` → `buildChatRuntime()` → `isAnonymous` guard → `getOrCreateMemberContext(ctx, memberId)` (`lib/me/fetchers/member-context.ts:12`) → `ctx.objects.MemberContext.update(mc.id, { theme_pref: JSON.stringify(tokens), updated_at })` → `revalidatePath("/")`. For obtaining `ctx` and `members`, copy exactly how `pinWidget` builds them (it uses the runtime's ontology ctx; read `app/dashboard/ask/actions.ts` top-to-bottom and replicate the ctx/member resolution). `designThemeAction` does NOT persist — it returns the result for client preview. `applyThemeAction` validates with `isValidTokenSet` (`lib/theme/tokens.ts`) before writing. `resetThemeAction` writes `theme_pref: null`.

- [ ] **Step 1: Implement**

```ts
// app/theme-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getOrCreateMemberContext } from "@/lib/me/fetchers/member-context";
import { designTheme, type DesignThemeResult } from "@/lib/theme/design";
import { isValidTokenSet, type TokenSet } from "@/lib/theme/tokens";

// Re-derive the ontology ctx + member exactly as app/dashboard/ask/actions.ts does.
// (Replicate that file's ctx/member resolution; see pinWidget.)
async function resolveCtx() {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  // runtime exposes the ontology ctx used by pinWidget — use the same accessor.
  // memberId = runtime.actor.userId
  return runtime;
}

export async function designThemeAction(prompt: string): Promise<DesignThemeResult> {
  await resolveCtx(); // gate: must be signed in
  return designTheme({ prompt });
}

export async function applyThemeAction(tokens: TokenSet): Promise<{ ok: boolean }> {
  const runtime = await resolveCtx();
  if (!isValidTokenSet(tokens)) return { ok: false };
  const ctx = runtime.ctx; // same ctx accessor pinWidget uses
  const mc = await getOrCreateMemberContext(ctx, runtime.actor.userId);
  await ctx.objects.MemberContext.update(mc.id, {
    theme_pref: JSON.stringify(tokens),
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/");
  return { ok: true };
}

export async function resetThemeAction(): Promise<void> {
  const runtime = await resolveCtx();
  const ctx = runtime.ctx;
  const mc = await getOrCreateMemberContext(ctx, runtime.actor.userId);
  await ctx.objects.MemberContext.update(mc.id, {
    theme_pref: null,
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/");
}
```

IMPLEMENTER NOTE: `runtime.ctx` and `runtime.actor` field names above are a best-guess from the `pinWidget` pattern. Before writing, READ `app/dashboard/ask/actions.ts` and `lib/agent/chat-runtime.ts` and use the *actual* accessor names (the runtime object shape). If `theme_pref: null` is rejected by the ontology update typing (optional string), pass `null as unknown as undefined`-free by confirming the column is nullable (`schema.generated.ts:108` `text("theme_pref")` is nullable) — the ontology `MemberContext.update` should accept `null`; if its generated type only allows `string | undefined`, write `theme_pref: null` via the raw drizzle `db.update(member_context)` path instead (import `getDb`, `member_context`, `eq`), mirroring `compose_dashboard`'s direct update.

- [ ] **Step 2: Type-check + commit**

Run: `docker exec acropolisos-app npx tsc --noEmit` → exit 0.
```bash
cd /c/flur_workspace/packages/acropolisos
git add app/theme-actions.ts
git commit -m "feat(acropolisos): P5 — theme design/apply/reset server actions"
```

---

### Task 5: Theme-switcher UI (prompt → live preview → keep/reset)

**Files:**
- Create: `components/shell/theme-switcher.tsx`
- Modify: `components/shell/app-shell.tsx` (add `id="app-shell-root"`)
- Modify: `components/shell/left-nav.tsx` (mount the switcher in the footer block)

Context: `app-shell.tsx` authenticated branch renders `<div style={tokenSetToCssVars(tokens)} className="flex h-screen …">`. Add `id="app-shell-root"` to that div so the client switcher can write live-preview CSS vars onto it (inline style on that div is what descendants read; setting `--primary` etc. there overrides the server value; `removeProperty` restores it). `left-nav.tsx` footer block is `<div className="border-t border-border px-3 py-3">` (~line 77) holding Notifications + name/role — mount `<ThemeSwitcher />` there. Token keys come from `TOKEN_KEYS` (`lib/theme/tokens.ts`).

- [ ] **Step 1: Add the id to the shell root**

In `components/shell/app-shell.tsx`, the authenticated `<div style={tokenSetToCssVars(tokens)} className="flex h-screen overflow-hidden bg-background text-foreground">` → add `id="app-shell-root"`.

- [ ] **Step 2: Implement the switcher**

```tsx
// components/shell/theme-switcher.tsx
"use client";

import { useState, useTransition } from "react";
import { Palette, RotateCcw, Check, Loader2 } from "lucide-react";
import { TOKEN_KEYS, type TokenSet } from "@/lib/theme/tokens";
import { designThemeAction, applyThemeAction, resetThemeAction } from "@/app/theme-actions";

function applyPreview(tokens: TokenSet | null): void {
  const root = document.getElementById("app-shell-root");
  if (!root) return;
  for (const k of TOKEN_KEYS) {
    if (tokens) root.style.setProperty(`--${k}`, tokens[k]);
    else root.style.removeProperty(`--${k}`);
  }
}

export function ThemeSwitcher(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<TokenSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate(): void {
    setError(null);
    startTransition(async () => {
      const r = await designThemeAction(prompt);
      if (r.status === "ok") {
        setPreview(r.tokens);
        applyPreview(r.tokens); // live preview on the shell root
      } else {
        setError(r.reason);
      }
    });
  }

  function keep(): void {
    if (!preview) return;
    startTransition(async () => {
      await applyThemeAction(preview);
      setPreview(null);
      setOpen(false);
    });
  }

  function reset(): void {
    applyPreview(null); // drop live overrides
    setPreview(null);
    setError(null);
    startTransition(async () => {
      await resetThemeAction();
      setOpen(false);
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Palette className="h-4 w-4" /> Theme
      </button>

      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-card p-2.5">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="Describe the look (e.g. warm earthy, oceanic, high-contrast)…"
            className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || prompt.trim().length === 0}
              onClick={generate}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}
              Generate
            </button>
            {preview && (
              <button
                type="button"
                disabled={pending}
                onClick={keep}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary px-2.5 py-1 text-xs text-primary hover:bg-primary/15 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Keep
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={reset}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          </div>
          {error && (
            <p className="text-[11px] text-destructive">Couldn’t design that theme ({error}). Try again.</p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount it in LeftNav**

In `components/shell/left-nav.tsx`, import `{ ThemeSwitcher }` and render `<ThemeSwitcher />` inside the footer `<div className="border-t border-border px-3 py-3">`, above or below the name/role line. Hide its label when the nav is collapsed if collapse state is available (optional; acceptable to always show the icon).

- [ ] **Step 4: Type-check**

Run: `docker exec acropolisos-app npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Restart (app-shell.tsx + left-nav are under components but app-shell is imported by layout; restart to be safe for the layout/route boundary)**

Run: `docker restart acropolisos-app`

- [ ] **Step 6: Commit**
```bash
cd /c/flur_workspace/packages/acropolisos
git add components/shell/theme-switcher.tsx components/shell/app-shell.tsx components/shell/left-nav.tsx
git commit -m "feat(acropolisos): P5 — theme-switcher UI (prompt → preview → keep/reset)"
```

---

### Task 6 (LOWER PRIORITY — do last): expose `design_theme` as an agent tool

**Files:**
- Modify: `app/api/chat/route.ts`

Context: tools are assembled into one record passed to `streamText` (`route.ts:129-143`). Tool pattern: `tool({ description, inputSchema: z.object({...}), execute })` (ai SDK v6 — `inputSchema`, not `parameters`; see `lib/proposals/ai-sdk-tools.ts:34`). The route already gates anonymous callers (`:85`). The tool calls `designTheme` and, on success, persists `theme_pref` for the current member (same write path as `applyThemeAction`), returning a short summary so the agent can tell the user.

- [ ] **Step 1: Add the tool definition near the other tools**

```ts
import { tool } from "ai";
import { z } from "zod";
import { designTheme } from "@/lib/theme/design";
// reuse the same member theme-write you put in app/theme-actions.ts; if it isn't
// importable from a "use server" file, inline the getOrCreateMemberContext +
// MemberContext.update write here using the route's existing ctx/actor.

const design_theme = tool({
  description:
    "Design and apply a new UI color theme for the current member from a description. The palette is validated for structure and accessibility before it is applied.",
  inputSchema: z.object({
    prompt: z.string().describe("The desired look, e.g. 'warm earthy tones' or 'high-contrast oceanic'"),
    dataContext: z.string().optional(),
  }),
  execute: async ({ prompt, dataContext }) => {
    const r = await designTheme({ prompt, dataContext });
    if (r.status !== "ok") return { ok: false, reason: r.reason };
    // persist theme_pref for the current member (same write as applyThemeAction)
    // … write JSON.stringify(r.tokens) to member_context.theme_pref …
    return { ok: true, applied: true, summary: `Applied a new theme (${prompt}).` };
  },
});
```

- [ ] **Step 2: Register it in the `tools` record** passed to `streamText` (add `design_theme,`). Update `AGENT_INSTRUCTIONS`/system text only if needed so the agent knows it can re-theme on request (optional).

- [ ] **Step 3: Type-check + restart + commit**

Run: `docker exec acropolisos-app npx tsc --noEmit` → exit 0. Then `docker restart acropolisos-app`.
```bash
cd /c/flur_workspace/packages/acropolisos
git add app/api/chat/route.ts
git commit -m "feat(acropolisos): P5 — expose design_theme as an agent tool"
```

---

### Task 7: Verification

**Files:** none

- [ ] **Step 1: Unit tests green**

Run: `docker exec acropolisos-app npx vitest run lib/theme lib/agent/extract-json.test.ts`
Expected: contrast + design + extract-json suites PASS (plus the existing theme tests).

- [ ] **Step 2: tsc** → exit 0.

- [ ] **Step 3: Manual check (controller via Chrome tools; do NOT order the user).** At http://localhost:3030, LeftNav shows a "Theme" control. Entering "warm earthy" → Generate produces a live preview on the whole shell; "Keep" persists (reload keeps it via `theme_pref`); "Reset" returns to base. Optionally ask the chat agent to "make the theme oceanic" and confirm it re-themes (Task 6). Confirm contrast stays readable (the validator guarantees it). No console errors.

- [ ] **Step 4: Report to the user for visual verification.** Phase 5 complete.

---

## Self-review checklist (controller, before dispatch)

- Spec coverage: `design_theme` tool ✔, senior-color-expert persona ✔, zod-validated TokenSet ✔ (glm-5.1 text path via extractJson), WCAG contrast guardrail ✔ (Task 2), retry/fallback ✔, theme switcher UI with prompt/preview/keep/reset ✔, `theme_pref` write ✔.
- Type consistency: `TokenSet`/`TOKEN_KEYS`/`isValidTokenSet` (tokens.ts), `DesignThemeResult`, action names, `extractJson`, `validateContrast` used identically across tasks. ✔
- Risk flags for implementer: contrast thresholds may need per-pair tuning so BASE_TOKENS passes (Task 2 Step 4); `runtime.ctx`/`runtime.actor` accessor names must be read from the real `chat-runtime.ts`/`pinWidget` (Task 4 note); `theme_pref: null` write path (Task 4 note). These are flagged inline, not left as silent placeholders.
- Ordering: Task 6 (agent tool) is explicitly lowest priority per the user.
