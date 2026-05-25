# Ontology Graph Visualization — Design

**Date:** 2026-05-25
**Branch (proposed):** `feat/acropolisos-ontology-graph`
**Status:** design — awaiting user review before writing-plans

---

## Goal

Render acropolisOS's ontology as one interactive graph at `/graph`, so a human can
*see* the system's shape and — critically — see exactly what the AI is allowed to do
autonomously vs. what is gated behind human confirmation. The graph is the **shared model
between humans and AI**: humans verify the structure, AI operates inside the verified
structure, and the picture is the proof.

## Why this is the special thing

Every "AI for orgs" tool treats the AI as a black box and bolts logs on afterward.
acropolisOS inverts this: the human-AI verification contract is **already encoded** in the
ontology and currently invisible (buried in YAML). This feature surfaces it. We are not
inventing trust machinery — we are *rendering* the trust machinery that already exists:

- `action_types[*].agent_policy` — `auto_apply` | `confirm_if_unfamiliar` | `always_confirm`
- `action_types[*].permissions` — which roles may trigger the action
- `action_types[*].side_effects` — `audit` | `notify_member` | `notify_steward` | `webhook`
- `action_types[*].creates_object | creates_link | updates | deletes` — the graph mutation

Positioning thesis (Miessler, *Companies Are Just a Graph of Algorithms*): every org is a
graph of algorithms; the differentiator is **whose objective function it serves**.
acropolisOS = a legible graph governed for *member agency*, with AI bounded by a
human-verified contract. The graph view is where that thesis becomes visible.

## Architecture: one model, two renderings

```
ontology/*.yaml ──loadOntology()──▶ Ontology (typed, integrity-checked)
                                          │
                  ontologyToGraph() ──────┤  (pure, tested)
                                          ▼
                            GraphModel { nodes, edges }
                                          │
              ┌───────────────────────────┴───────────────┐
              ▼                                            ▼
   /graph (RSC) serializes JSON           (future) executable edges for AI/n8n
              ▼
   <OntologyGraph/> client (React Flow)
```

The existing `loadOntology(root)` (`lib/ontology/load.ts`) is the single source of truth —
already used at boot for codegen. We reuse it; we introduce **no new ontology terms** and
no new data store. The graph is a pure projection of existing files.

## Graph model

`ontologyToGraph(ontology): GraphModel` — pure function, fully unit-tested.

**Nodes** — one per `object_types` key:
- id = type name; label = name (use `title_property` as the display hint)
- carries property count + read/write permission roles for the inspector panel

**Relation edges** — one per `link_types` entry:
- `from → to`, label = link name, sublabel = cardinality (e.g. `many-to-many`)
- solid line; these are structural relations

**Action elements** — one per `action_types` entry. An action attaches to the object
type(s) it touches, derived deterministically:
- `creates_object: X` → action ──creates──▶ node X (dashed "mutation" edge)
- `creates_link: Y` → action contributes to relation Y (annotate that edge)
- `updates: X` / `deletes: X` → action ──updates/deletes──▶ node X (dashed)
- `parameters[*].type==="ref"` with `target: X` → action reads X (dotted, faint)
- color by `agent_policy`; badge with `permissions` roles; icon set by `side_effects`

Actions render as small labeled chips anchored on/near their primary target node, NOT as
full nodes, to keep the graph legible (13 objects + ~13 actions + 6 links).

## The legend (the payload)

A fixed legend panel, always visible:

| Color | `agent_policy` | Meaning |
|-------|----------------|---------|
| 🟢 green | `auto_apply` | AI runs this autonomously — structure pre-verified by humans |
| 🟡 amber | `confirm_if_unfamiliar` | AI runs if familiar; otherwise asks a human |
| 🔴 red | `always_confirm` | AI must get explicit human confirmation every time |

Plus a small note: edge styles (solid = relation, dashed = mutation, dotted = reads) and a
role-badge key. This single panel is what makes a non-technical steward able to *verify*
the AI's authority at a glance.

## Interaction (first cut)

- Pan / zoom / fit-view (React Flow built-ins).
- Auto-layout via React Flow's layout (or a light `dagre` pass for a clean DAG) so it looks
  organized on first paint — no manual node placement.
- Click a node → side inspector panel: properties, permissions, and the actions that
  touch it (with their policy + roles).
- Read-only. No graph editing in this cut (editing the structure = editing YAML, which is
  the governed path; a visual editor is explicitly out of scope here).

## Components & files

- **Create** `lib/graph/derive.ts` — `ontologyToGraph(ontology): GraphModel`; `GraphModel`,
  `GraphNode`, `GraphEdge`, `GraphAction` types. Pure.
- **Create** `lib/graph/derive.test.ts` — vitest: node-per-object, edge-per-link with
  cardinality, action attaches to correct target via creates/updates/deletes/ref-param,
  policy/permission carried through, deterministic output.
- **Create** `app/graph/page.tsx` — RSC: `loadOntology(ONTOLOGY_ROOT)` → `ontologyToGraph`
  → render `<OntologyGraph model={...} />`. (Reuse the same root path codegen uses.)
- **Create** `components/graph/ontology-graph.tsx` — client, `@xyflow/react`. Custom node =
  object box (semantic tokens only — `bg-card`, `text-foreground`, `border-border`,
  `text-primary`). Custom edge styles. Legend panel. Inspector panel.
- **Create** `components/graph/legend.tsx` + `components/graph/inspector.tsx` (split for
  focus).
- **Modify** `package.json` — add `@xyflow/react`.
- **Modify** left-nav (`components/shell/left-nav.tsx`) — add a "Graph" entry.

## Non-goals (this cut)

- No graph editing / visual ontology authoring (Tier-3; against the axiology).
- No live runtime overlay (which actions fired recently) — fast follow.
- No n8n emit — separate spec (the "executable edges" rendering).

## Governance / axiology

- **Axiom 1 (Coherence):** additive — no existing view shows this; replaces nothing, but
  consumes only existing ontology terms (introduces zero new ones).
- **Axiom 2 (Structural Governance):** the view *is* governance made visible — it renders
  the linter-enforced ontology contract.
- **Axiom 3 (Reification):** graph = the artifact stage of the ontology's reification.
- **Clean break / tokens:** semantic Tailwind tokens only; no hardcoded colors except the
  three policy colors, which are a deliberate domain legend (define them as named tokens).

## Test strategy

- `lib/graph/derive.ts` is pure → exhaustively unit-tested (the real value lives here).
- Component is presentational over the tested model → verify in-browser (Chrome) on the
  steward account at `http://localhost:3030/graph`: legend renders, all 13 objects + links
  appear, action policies colored correctly, click-inspect works, pan/zoom works.
