# acropolisOS UI Rework — Design Spec

**Date:** 2026-05-25
**Status:** Approved design, pre-plan
**Branch target:** new branch off `main` (`feat/acropolisos-ui-rework`)

---

## Problem

The overnight rebuild rewrote the *backend* (assimilation pipeline, widget
composition, read-only data API, per-user dashboard) but the **visual layer
barely moved**. The home page (`app/page.tsx`) is austere monochrome zinc cards,
10px uppercase labels, `text-xs` throughout, **no navigation chrome**, dashed-border
CTAs — it reads as a *debug view*, not a product. The user's reaction on testing:
"nothing seems much changed."

**Root cause (the unlock):** every page hardcodes Tailwind palette classes
(`bg-zinc-950`, `border-zinc-800`, `text-zinc-100`, …) — **296 occurrences across
21 files**. This *bypasses the CSS-variable token system* already defined in
`globals.css` (`--background`, `--primary`, `--card`, … as oklch tokens wired via
Tailwind v4 `@theme inline`). That single fact causes *both* symptoms:

1. The UI looks like an unstyled dev tool.
2. Runtime theming is impossible — there are no tokens to swap, only hardcoded literals.

Fixing the token bypass fixes both at once.

---

## Goal

A coherent, product-grade UI with a governed app shell and a **runtime-themeable**
skin, where customization is *choosing values within a governed vocabulary*, never
authoring structure.

The guiding principle (consistent with the existing widget-catalog pattern and the
project axioms — Structural Governance, Coherence Before Creation):

> **The shell is invariant. The skin (theme) and the contents (widgets) vary —
> but only by choosing values within a governed vocabulary, never by authoring
> new structure.**

This is composition-over-generation applied to look-and-feel.

---

## Decisions (locked with the user)

| Decision | Choice |
|---|---|
| Layout shape | **A · Co-pilot dock** — left nav, center dashboard (main), right AI chat |
| Side panels | Left nav + right dock both **collapsible/expandable** |
| Primary surface | **Dashboard** is main; agent is an ever-present co-pilot |
| Customization Tier 1 (theme tokens) | **YES** |
| Customization Tier 2 (arrangement) | **YES** |
| Customization Tier 3 (free UI building / page builder / custom CSS) | **NO — out of scope, on principle** |

---

## Architecture

### 1. App shell (replaces current layout)

Current `app/layout.tsx` renders `{children}` plus a fixed-bottom `ChatPanel`
(`@/components/chat-panel`), `MutationPulseMount`, `ReloadToast`, `TopProgressBar`.

New three-region shell wrapping every authenticated page:

```
┌─────────────────────────────────────────────────────────┐
│ ◆ acropolis            [topbar: title · bell · account]  │
├──────────┬──────────────────────────────────┬───────────┤
│ LeftNav  │  center: page content / dashboard │ CoPilot   │
│ (collap- │  (MAIN)                            │ Dock      │
│  sible)  │                                    │ (collap-  │
│  Home    │                                    │  sible    │
│  Organize│                                    │  chat)    │
│  Connect │                                    │           │
│  Ontology│                                    │           │
│  People  │                                    │           │
│  ─────   │                                    │           │
│  theme ⊙ │                                    │           │
└──────────┴──────────────────────────────────┴───────────┘
```

- **`<AppShell>`** (new) — server component, owns the grid. Resolves session + theme,
  renders LeftNav, the children slot, and the CoPilotDock.
- **`<LeftNav>`** (new, client for collapse) — nav links (Home `/`, Organize `/organize`,
  Connect `/connect`, Ontology `/ontology`, People `/me` or members list), notifications
  bell (reuses `/api/notifications/unread-count`), account, theme switcher entry point.
- **`<CoPilotDock>`** — **repositions** the existing chat into a right dock. Reuse the
  current ChatPanel internals (same agent, same `actorRole`/`modelName` props); change
  its container/positioning from fixed-bottom to right-docked + collapsible. **Clean break:**
  delete the bottom-panel positioning, do not keep both.
- **Collapse state** — persisted in `localStorage` (`acro.nav.collapsed`,
  `acro.dock.collapsed`). Pure client UI pref; no server round-trip. SSR renders the
  default (both expanded) and a small client effect applies the stored state.
- **Signin / setup** (`/signin`, `/setup`) render *outside* the shell (no nav/dock).

### 2. Token migration (the bulk of the work)

Migrate the 21 files' hardcoded palette classes to semantic tokens:

| Hardcoded | Semantic token class |
|---|---|
| `bg-zinc-950`, `bg-black` | `bg-background` |
| `bg-zinc-900/30`, surfaces | `bg-card` |
| `text-zinc-100`, `text-white` | `text-foreground` |
| `text-zinc-500/600` | `text-muted-foreground` |
| `border-zinc-800` | `border-border` |
| accent/active states | `text-primary` / `bg-primary` |

`globals.css` already defines `:root` (light) and `.dark` token sets and the
`@theme inline` mapping, so `bg-background` etc. already resolve. After migration the
entire UI re-skins from the token layer.

**Scope guard:** this is a mechanical-but-careful migration. Do it page by page,
visually verifying each. It is the largest single chunk and the highest-value one.

### 3. Tier-1 theming system

**Approach (revised):** ship **one** base palette now; make the *generative source* an
**AI color-designer agent**, not a preset registry. The governed vocabulary is the
**fixed token schema** — the token *names and roles* (`--background`, `--foreground`,
`--primary`, `--card`, `--border`, …) are invariant. The agent fills in *values* within
that schema; it cannot add tokens or alter structure. Validation (valid oklch + WCAG
contrast floors) is the governance that replaces the preset list.

- **`lib/theme/base.ts`** — the single base palette = the token value set already in
  `globals.css` `:root`/`.dark` (`indigo`-ish dark default), formalized as the canonical
  `TokenSet` type. This is the always-available floor.
- **`TokenSet`** — typed shape: every CSS variable name → oklch string. The schema is the
  vocabulary; a theme is *any valid TokenSet*, base or agent-generated.
- **AI color-designer agent** (the generative source — *lower priority per user, later phase*):
  - Agent tool `design_theme({ prompt?, dataContext? }) → TokenSet`.
  - **System prompt persona:** a senior UI designer / color expert in interface aesthetics.
    It receives (a) the user's prompt ("make it warm / oceanic / like our brand") and/or
    (b) data context (org domain, dominant ontology types) and produces a complete `TokenSet`.
  - **Output discipline:** `generateText` → JSON-parse → **zod-validate** (glm-5.1 has no
    json_schema support — see memory). Then a **contrast/accessibility check** (foreground-on-
    background, primary-on-primary-foreground meet WCAG AA); reject + retry/fallback if it fails.
    This is the structural guardrail: the agent has color freedom but cannot ship an unreadable
    or malformed theme.
- **`lib/theme/resolve.ts`** — `resolveTheme({ memberPref, role, orgSeed })` precedence:
  **explicit user pref (stored TokenSet) → per-role default → data-derived → base**.
  Mirrors the dashboard's `pinned_widgets > SLICE_SPEC` precedence.
- **`<ThemeProvider>`** — resolved **server-side in the shell** (no flash-of-wrong-theme).
  Emits the resolved `TokenSet` as inline CSS variables on the shell root
  (`<div style="--background: …; --primary: …">` or a `<style>` block). Tailwind classes read them.
- **Storage** — `theme_pref text` (nullable) on `member_context` (beside `pinned_widgets`),
  storing the resolved **TokenSet as JSON** (same JSON-in-text pattern as `pinned_widgets`),
  not an enum. **Decision (open Q1):** plain system column on `member_context` — theming is a
  UI preference, not a world-model entity, so it does **not** go through the ontology codegen
  path. Still needs a matching `ALTER TABLE member_context ADD COLUMN IF NOT EXISTS theme_pref text`
  in the bootstrap/migrate path (memory: schema-drift gotcha).
- **Theme switcher UI** — a control in LeftNav: opens a prompt ("describe the look you want"),
  calls `design_theme`, previews, applies → writes `theme_pref`. A "reset to base" always exists.

### 4. Tier-2 arrangement

- **Panel collapse** — covered by the shell (§1).
- **Widget pin / unpin / reorder** — the backend exists: `compose_dashboard(db, memberId,
  selections)` writes `member_context.pinned_widgets`, and `resolvePerUserDashboard`
  already prefers non-empty pins over `SLICE_SPEC`. **Missing: the UI affordance.** Add
  pin/unpin + reorder controls on the dashboard that call a server action wrapping
  `compose_dashboard`. Stays within the governed catalog — the user arranges, never invents.
- Out of scope for v1 if time-bound: drag-reorder polish (can be add/remove + up/down first).

---

## Data flow

```
request → AppShell (server)
  → auth() → session actor → member row (id, tier_role)
  → member_context row (pinned_widgets, theme_pref)
  → resolveTheme({memberPref: theme_pref, role: tier_role, orgSeed})
       → palette token values → inline CSS vars on shell root
  → resolvePerUserDashboard(db, member)   [unchanged, read-only]
       → ResolvedWidget[] → center content
  → CoPilotDock (client) hydrates with actorRole/modelName
client:
  collapse toggles → localStorage
  theme switch → server action → write member_context.theme_pref → revalidate
  pin/unpin/reorder → server action → compose_dashboard → revalidate
```

The read-only fence is preserved: theming and arrangement write **only** to
`member_context` (preferences), never to the world-model. The dashboard data path
stays strictly read-only via `ReadOnlyDataApi`.

---

## Components & units (each independently testable)

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/theme/palettes.ts` | The governed palette vocabulary (token value sets) | — |
| `lib/theme/resolve.ts` | Precedence resolution → resolved palette | palettes |
| `components/shell/app-shell.tsx` | Grid + server theme/session resolution | resolve, auth |
| `components/shell/left-nav.tsx` | Nav + collapse + theme switcher entry | — (client) |
| `components/shell/co-pilot-dock.tsx` | Right-docked collapsible chat | existing chat internals |
| `components/shell/theme-switcher.tsx` | Pick preset → server action | palettes |
| `app/me/theme-actions.ts` | Server action: write `theme_pref` | db, palettes |
| `components/dashboard/widget-controls.tsx` | Pin/unpin/reorder affordance | compose_dashboard |
| token migration | per-page class swaps | globals.css tokens |

---

## Error handling

- **Theme resolution failure / unknown pref** → fall back down the precedence chain to
  system default. Never render unstyled.
- **Corrupt `theme_pref`** → treat as null (same tolerance as corrupt `pinned_widgets`).
- **No member row** → existing "contact a steward" path, but now rendered inside the shell.
- **Chat/dock load failure** → dashboard still renders (dock is non-blocking, as today).

---

## Testing

- **Token migration:** visual verification per page in the browser (Chrome tools) under
  at least 2 themes — this is feature-correctness, not unit-testable. Plus `tsc --noEmit`.
- **`lib/theme/resolve.ts`:** unit tests for precedence (pref > role > seed > default;
  unknown pref degrades; null pref → role). TDD — write first. (Note acropolisOS vitest
  needs the `@/` alias — see memory.)
- **`set_theme` agent tool:** unit test that out-of-vocabulary input is rejected and a
  valid preset writes `theme_pref`.
- **Pin/unpin server action:** test it writes through `compose_dashboard` and the
  dashboard then prefers the pins (reuse `per-user-proof.ts` style).
- **Regression:** existing proof scripts (`integration-proof.ts` et al.) must stay green —
  the data path is untouched.

---

## Out of scope (the line drawn between Tier 2 and Tier 3)

- No drag-drop page builder, no user-authored components, no per-user/per-install CSS.
- No new widget *kinds* (catalog stays as-is).
- Full data-derived palette computation (beyond the simple org→preset seed).
- BYOK / multi-install hardening.

---

## Resolved decisions (were open questions)

1. **`member_context.theme_pref`** → **plain system column** (not codegen path); theming is a
   UI preference, not a world-model entity. Bootstrap gets `ALTER … ADD COLUMN IF NOT EXISTS`.
2. **Palettes** → **one base palette ships now**; the generative source is the **AI color-designer
   agent** (§3), not a preset registry. (Lower priority per user — agent designer is a later phase.)
3. **Widget reorder fidelity v1** → **add/remove + up/down** first (lower risk); full drag-drop later.

## Phasing (priority order)

1. **App shell** — collapsible nav + dashboard + right co-pilot dock (repositions ChatPanel).
2. **Token migration** — `zinc-*` → semantic tokens across 21 files. *The high-value core.*
3. **Base palette formalized** + `ThemeProvider` server-side application (one theme, themeable plumbing).
4. **Tier-2 arrangement** — pin/unpin/reorder UI over existing `compose_dashboard`.
5. **AI color-designer agent** — `design_theme` tool + persona + contrast-validated output. *(lower priority)*
```
