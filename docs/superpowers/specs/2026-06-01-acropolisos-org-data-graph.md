# Org Data Knowledge Graph — design spec

**Date:** 2026-06-01 · **Branch:** feat/acropolisos-ui-rework · **Status:** approved (option C — full + ego modes)

## Thesis

A new *render* of the existing model: `graph = render(ontology, DATA, viewer)`. Nodes = object
**instances**; edges = the ontology's declared **ref** columns + populated **link-type** tables. It is
the data-level sibling of the ontology graph already at `/graph` (which renders the type schema). No new
opinion, no new data path — a graph projection of the world-model, governed by the same read-fence.

## What's real (grounded against the live hostel DB, 2026-06-01)

Edges come from two sources:

1. **Ref columns** (the ontology declares `type: ref, target: X`) — the bulk, all populated:
   - `Bed.room→Room` (28), `Booking.guest→Guest` + `Booking.bed→Bed` (12 each),
     `WorkTradeAgreement.guest→Guest` + `.bed_comp→Bed` (3 each), `Shift.claimed_by→Member`,
     `Event.organizer→Member`, `IncidentLog.reported_by→Member`, `AgentBlocker.blocked_actor_id→Member`,
     `MeetingMinute.event_id→Event`, `MemberContext.member_id→Member` (300!), `Notification.recipient_member_id→Member` (31).
2. **Link tables** — only `guest_attended_event_event` is populated (17); `guest_booked_into_bed` /
   `incident_log_involves_guest` are empty; `staffed`/`trading_for` tables don't exist. So link edges are a
   *bonus* layer, not the backbone. (`ctx.links` is `{}` — the runtime link surface was removed — so link
   edges are read by querying the link tables directly in the source layer, read-only.)

**Scale:** `member` (306) + `member_context` (300) + `notification` (31) would dominate a single canvas.
⇒ both **type-filters** (hide high-cardinality types) and an **ego mode** (center one entity, N hops) — the
two modes chosen.

## Governance (the load-bearing invariant)

The graph is **viewer-scoped through the fence**: rows are fetched via `createReadOnlyDataApi(db,
canReadType, ontology)`; a type the viewer can't read yields **no nodes**, and any edge whose endpoint is a
dropped node is **dropped** (no dangling edges, no id leak). ⇒ a member's graph is a strict subset of the
steward's. This is the primary TDD invariant.

## Components / contracts

- **`lib/graph/data-graph.ts`** (PURE, the testable core)
  - `interface DataGraphNode { id; type; label; kind: string|null }`
  - `interface DataGraphEdge { id; source; target; label }`
  - `interface DataGraphModel { nodes: DataGraphNode[]; edges: DataGraphEdge[] }`
  - `deriveDataGraph(ontology, rowsByType: Record<type, Row[]>, linkEdges: {source,target,label}[], canReadType, opts?: { hiddenTypes?: string[]; focus?: {type,id}; hops?: number }): DataGraphModel`
    - node per row of each readable, non-hidden type (label = row[title_property] ?? id; kind = ot.kind).
    - edge per **ref** property whose value is non-null AND whose target node is present (readable+unhidden).
    - `+ linkEdges` filtered to present endpoints.
    - if `focus`: keep only nodes within `hops` (default 1) BFS of the focus node + incident edges.
  - Pure, no I/O, no DB, no domain literals — types/fields/refs all come from the ontology.
- **`lib/graph/force-layout.ts`** (PURE) — `forceLayout(model, {width,height,seed}): Map<id,{x,y}>`
  - deterministic given a seed (no `Math.random` at module scope; seed-driven PRNG) so it's testable.
  - repulsion + link spring + centering, fixed iteration count.
- **`lib/graph/data-graph-source.ts`** (server) — `loadDataGraph(db, ontology, canReadType, opts): Promise<DataGraphModel>`
  - fetch readable rows per type (via read-api), fetch link edges (direct read-only query of the
    populated link tables, mapped through canReadType for both endpoint types), then `deriveDataGraph(...)`.
- **`components/graph/data-graph.tsx`** (client renderer) — React Flow, positions from `forceLayout`.
  - node color = element kind (reuse `KIND_COLOR`); node click → `/[type]/[id]`.
  - Panel: type-filter checkboxes (toggle `?hide=`), an ego search/clear (`?focus=type/id`, `?hops=`).
  - reuse Background / Controls / Panel / Legend chrome.
- **`app/graph/page.tsx`** — add a `?view=schema|data` toggle (default schema, preserving today's behavior).
  - `view=data` → `loadDataGraph(...)` (passing `hide`/`focus`/`hops` from searchParams) → `<DataGraph>`.

## Acceptance

- `deriveDataGraph` unit tests: node-per-readable-row; edge-per-ref; **drop edge when target unreadable**;
  **member graph ⊂ steward graph**; hidden-types excluded; ego BFS keeps only N-hop neighborhood.
- `forceLayout` test: deterministic for a fixed seed; all positions within bounds.
- `tsc --noEmit` clean; M3 surface still green.
- Live: `/graph?view=data` renders the hostel graph; `?view=data&focus=guest/<id>` shows one guest's
  neighborhood; `?hide=member_context,notification,member` de-clutters. (Verified via in-container resolve +
  browser when available.)

## Out of scope (noted, not built)

Populating the empty link tables; the residual orphaned `attended`/`authored` link types; clustering/
WebGL for >1k nodes (ego mode + filters cover the demo scale).
