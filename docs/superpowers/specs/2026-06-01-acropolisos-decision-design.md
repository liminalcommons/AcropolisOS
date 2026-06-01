# Decision Design — the opinionated disposition surface

**Date:** 2026-06-01 · **Status:** approved (surface = **Focus / one-at-a-time**) · **Branch:** AcropolisOS.git main

## Why this is opinionated

acropolisOS is adaptive by default — types, fields, actions, screens are generated per org. **Decisions are one of the few deliberately opinionated primitives**: "machine proposes, human disposes." The *form* of a decision is governance, not org content, so it is fixed and well-designed across every org. This spec makes the existing `agent_blocker` primitive a **first-class, structured, focused** surface.

## The opinionated anatomy (locked)

Every decision, every org, renders with the same structure:
- **Framing** — `summary` + `detail` + the `reason_kind` made legible (one of: approval, confirmation, ambiguity, missing_data, consent, decision, risky_action).
- **≤3 scenarios**, each: `label · consequence (rationale) · reversibility`. Reversibility tier ∈ `easy | moderate | permanent` (existing `Pathway.reversibility`), shown safest-first and **never** re-ordered below a less-reversible option by popularity (`rankPathways`).
- **Disposition** — one of three resolution modes: `pathways` (pick a scenario), `text_input` (supply data), `confirm_binary` (yes/no).
- **Learning trace** — "the community usually picks X (n/m)" from `computePathwayPreference` over resolved same-reason decisions.

Data model is already sufficient (`Pathway = {id,label,rationale,action,reversibility}`); this is a **presentation** build, not a schema change.

## Surface = Focus (one at a time)

The veto-queue presents the **single highest-priority** open decision as a weighty card; disposing it advances to the next. A small counter ("Decision 1 of N") + "skip →" gives navigation; an "all clear" state when empty.

- **Queue order (opinionated):** oldest-first (SLA — don't let judgment calls rot). Severity-weighting is a noted future refinement.
- **The card:** framing block → the ≤3 scenarios as full **choice rows** (label, consequence, reversibility chip with a friendly label, the safest one badged "recommended") → mode-appropriate disposition → trace line → Dismiss + Skip.
- **Disposition wiring:** reuses the existing server actions (`resolveVetoAction(blockerId, pathwayId?)`, `dismissVetoAction`); `text_input`/`confirm_binary` modes render the matching control and call the same resolve path.
- **Autonomy split** (auto-applied · escalated) stays at the top — "the autonomy you can see."

## Components / contracts

- **`lib/blockers/decision-view.ts`** (PURE, testable):
  - `type ReversibilityTier = "easy"|"moderate"|"permanent"`
  - `interface DecisionScenario { id; label; consequence: string; reversibility: ReversibilityTier; recommended: boolean }`
  - `interface DecisionView { id; summary; detail; reasonKind; createdAt; blockedActorId: string|null; mode: "pathways"|"text_input"|"confirm_binary"; scenarios: DecisionScenario[]; trace: { label: string; count: number; total: number } | null }`
  - `orderDecisionQueue(blockers): blockers` — oldest-first (stable).
  - `buildDecisionView(blocker, allBlockers): DecisionView` — parse + `rankPathways` (safest-first + preference) → scenarios; `recommended` = first scenario; `trace` from `computePathwayPreference` for the blocker's reason_kind (the top identity + its share). Reversibility default `moderate` when unset (matches `rankPathways`).
- **`components/decisions/decision-focus.tsx`** (client): receives the ordered `DecisionView[]`, holds the current index, renders the focus card, calls the server actions on dispose, advances (router.refresh) on success; renders the all-clear state.
- **`app/veto-queue/page.tsx`** (server): builds the ordered view models (+ autonomy split) and hands them to `<DecisionFocus>`. Steward-only (unchanged gate).

## Acceptance

- `decision-view` unit tests: oldest-first ordering; scenarios ranked safest-first; `recommended` = safest; reversibility never demoted by preference; trace reflects the majority identity; mode passthrough; empty/!pathways handled.
- `tsc --noEmit` clean; M3 surface green.
- Live: a seeded `decision` with rich pathways (consequence + reversibility) renders as a focus card on `:3032/veto-queue`; picking a scenario resolves it and advances; empty state shows "all clear".

## Propagation note (instance copies)

New `lib/blockers/decision-view.ts` must be copied into `empty-instance/lib` + `book-club-instance/lib` (they mount copies of `lib/`), and `.next` cleared, or those instances 404 on recompile. (Underlying fragility flagged separately.)

## Out of scope (noted)

Severity-weighted queue ordering; consequence/reversibility authoring UI for the agent; batch disposition; the data-graph "decision" node type.
