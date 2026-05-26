# acropolisOS Adaptive View-Generation — Design

**Date:** 2026-05-25
**Status:** design — approved direction; build subagent-driven, in-session (NOT Ralph TUI — work is discovery-driven and needs live steering)

## Goal

Move acropolisOS from hand-coded, opinionated screens toward **agent-generated, governed views**: the org describes itself (ontology), and acropolisOS's native agent **composes** the views it needs (a bed list, the day view, role dashboards) from a governed vocabulary — never free-form code. See [[acropolisos-adaptive-architecture]].

## What already exists (audit 2026-05-25)

- **Backend generation:** `lib/codegen/*` + `lib/proposals/` (propose→apply→regenerate) emit tables/types/tools from the ontology. Backend-only; never touches UI.
- **Governed widget vocabulary:** `lib/widgets/catalog.ts` (kinds: `metric`, `data_table`, `roster`, `calendar` — validated configs + read-only `queryBinding`s), `lib/widgets/read-api.ts` (locked-down SELECT chokepoint, whitelisted types/fields), `lib/widgets/compose.ts` (`compose_dashboard` persists `member_context.pinned_widgets`), `per-user.ts` (role defaults), `arrange.ts`.
- **Safe open-ended seam:** `components/dashboard/PinnedWidget.tsx` has an `agent_html` kind — arbitrary HTML in a sandboxed (`allow-same-origin`, no-scripts) iframe. Nothing produces it yet.

## The gap (the keystone)

1. **No agent composes views.** Composition happens via UI buttons (`pinWidget`, `arrange-actions`), not an agent tool. There is no `compose_view`/`generate_dashboard` tool exposed to the chat agent.
2. **Read surface covers only 4 of 13 object types.** `lib/ontology/pg-store.ts` (`createPgOntologyStore`) hand-wires `Member`/`Event`/`MemberContext`/`AgentBlocker` only; `read-api.ts` separately whitelists 8. Both hand-maintained → Booking/Bed/Shift/etc. can't be read/acted-on generically. This is why the bed list can't exist and `/day` used raw SQL.

## Governance principle (the design's spine)

Be opinionated about the **vocabulary**, adaptive in the **composition**. The agent emits a view by choosing governed widgets + validated configs over the ontology; the existing config validation + read-API whitelist + sandbox keep it coherent and safe. **Catalog-first**; `agent_html` is the *escape hatch* only for layouts the catalog can't express. New widget *kinds* are added deliberately by developers when a pattern recurs — the vocabulary grows on purpose, never ad hoc.

## Plan (incremental, subagent-driven)

### Step 1 — Foundation: registry-driven read surface
Make `ctx.objects` (and ideally the widget read-API whitelist) cover **all** ontology object types, derived from the ontology/generated schema instead of a hand-maintained dict — preserving the exact permission-wrapping semantics of the current 4. Unblocks views/actions over every type; removes the raw-SQL workaround in `/day`. Mechanical, high-leverage, security-sensitive (do not weaken permission checks).

### Step 2 — Keystone MVP: a `compose_view` agent tool
One chat-agent tool that, given a request ("show me my beds") + the ontology, emits a **governed widget composition** (e.g. a `data_table` over `Bed`), validated through the existing catalog/read-API path and persisted via `compose_dashboard`. Prove it by generating the **bed list** end-to-end. Catalog-only in this step (no `agent_html` yet).

### Later (not now)
- The day view as a generated composition (it's `data_table` + `roster` over date-filtered queries — the hand-built `/day` is its spec).
- `agent_html` escape hatch for novel layouts.
- The AI-governance loop (AI proposes/auto-applies per `agent_policy`; human vetoes) over the generated surfaces.

## Non-goals
- Free-form code generation (fragile/incoherent — rejected in favor of governed composition).
- Bolting view-gen onto the proposals pipeline (that pipeline is backend-only and rolls back the filesystem; wrong seam).
- Generating new widget *kinds* by agent (kinds stay developer-authored vocabulary).

## Test strategy
- Step 1: unit-test that the read surface exposes all object types and that permission checks still gate each (no regression on the existing 4).
- Step 2: unit-test the composition validates/persists; verify the generated bed list in-browser.
