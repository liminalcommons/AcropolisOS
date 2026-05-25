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

- **`lib/theme/palettes.ts`** — a typed registry of preset palettes. Each palette is a
  full set of token values (oklch) for the variables in `globals.css`. Starter set
  (user can revise): `indigo-dark` (default), `desert-ochre`, `clean-light`, plus one
  more (e.g. `forest`/`slate`). This registry **is the governed vocabulary**.
- **`lib/theme/resolve.ts`** — `resolveTheme({ memberPref, role, orgSeed })` with
  precedence: **explicit user pref → per-role default → data-derived seed → system default**.
  Mirrors the dashboard's `pinned_widgets > SLICE_SPEC` precedence exactly.
- **`<ThemeProvider>`** — resolved **server-side in the shell** (no flash-of-wrong-theme).
  Emits the resolved palette's token values as inline CSS variables on the shell root
  (`<div style="--background: …; --primary: …">` or a `<style>` block). Tailwind classes
  then read them.
- **Storage** — add `theme_pref text` (nullable) to `member_context` (sits beside
  `pinned_widgets`; same per-member table). **Gotcha:** `member_context` is in
  `schema.generated.ts`; adding a column must go through the generated-schema path AND
  get a matching `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in the bootstrap/migrate path
  (see memory: calendar bootstrap schema-drift + acropolisOS generated-files-not-bind-mounted).
  Plan must confirm the exact codegen vs. system-column decision.
- **Agent-requestable** — a bounded agent tool `set_theme(palette: <enum of preset names>)`
  that writes `member_context.theme_pref`. Vocabulary-constrained (enum, zod-validated) —
  the agent can pick a preset, never emit arbitrary CSS. Follows the existing
  `generateText + JSON-parse + zod-validate` pattern (glm-5.1 has no json_schema support).
- **Data-derived (v1, modest)** — `orgSeed`: a simple mapping from org domain / dominant
  ontology type → a preset name (e.g. hospitality → desert-ochre). Full data-derivation
  (computing a palette from data distributions) is explicitly a **later enhancement**,
  not in this rework.
- **Theme switcher UI** — a control in LeftNav: pick a preset; writes `theme_pref`;
  applies immediately.

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

## Open questions for the plan

1. `member_context.theme_pref` — add via the ontology codegen path, or as a hand-maintained
   system column? Must also land the `ALTER … ADD COLUMN IF NOT EXISTS` in the bootstrap.
2. Preset palette starter set — confirm the 3–4 palettes and their oklch values
   (user invited to supply brand colors; default set proposed above).
3. Widget reorder fidelity for v1 — add/remove + up/down vs. full drag-drop.
```
