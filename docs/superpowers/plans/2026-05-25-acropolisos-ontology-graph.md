# Ontology Graph Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render acropolisOS's ontology as an interactive `/graph` view where a human can see the system's shape and exactly which actions the AI may run autonomously (`auto_apply`) vs. those gated behind human confirmation (`always_confirm` / `confirm_if_unfamiliar`).

**Architecture:** One model, two renderings. The existing `loadOntology()` is the single source of truth → a new pure `ontologyToGraph()` projects it to a `GraphModel` → an RSC route serializes that to a React Flow client component. No new ontology terms, no new data store — a pure projection of existing YAML.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Tailwind v4 (semantic tokens), `@xyflow/react` (React Flow), `@dagrejs/dagre` (layout), vitest, zod v4.

**Environment:** Container `acropolisos-app`, app at http://localhost:3030, bind-mounted source (lib/components/app hot-reload). tsc: `docker exec acropolisos-app npx tsc --noEmit`. Tests: `docker exec acropolisos-app npx vitest run <path>`. npm installs MUST run inside the container: `docker exec acropolisos-app npm install <pkg>` (node_modules lives in the container layer; package.json is bind-mounted so the dep persists). Steward login: steward@acropolisos.local / acropolis2026.

---

## File Structure

- `lib/graph/derive.ts` — **NEW.** `GraphModel` types + pure `ontologyToGraph(ontology)`. The tested core; all real logic lives here.
- `lib/graph/derive.test.ts` — **NEW.** Exhaustive unit tests for the projection.
- `lib/graph/layout.ts` — **NEW.** Pure `layoutGraph(model)` → positioned nodes via dagre.
- `app/graph/page.tsx` — **NEW.** RSC: load ontology → derive → render client component.
- `components/graph/ontology-graph.tsx` — **NEW.** Client React Flow renderer (objects + relations + action chips).
- `components/graph/legend.tsx` — **NEW.** Policy color legend + edge-style key.
- `components/graph/inspector.tsx` — **NEW.** Click-a-node detail panel.
- `components/shell/left-nav.tsx` — **MODIFY.** Add a "Graph" nav entry.
- `package.json` — **MODIFY** (via container install): add `@xyflow/react`, `@dagrejs/dagre`.

---

### Task 1: GraphModel + pure `ontologyToGraph` projection

**Files:**
- Create: `lib/graph/derive.ts`
- Test: `lib/graph/derive.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/graph/derive.test.ts
import { describe, it, expect } from "vitest";
import { loadOntology } from "../ontology/load";
import { getRuntimeOntologyDir } from "../setup/paths";
import { ontologyToGraph, type GraphModel } from "./derive";

async function model(): Promise<GraphModel> {
  return ontologyToGraph(await loadOntology(getRuntimeOntologyDir()));
}

describe("ontologyToGraph", () => {
  it("emits one node per object type, sorted by id", async () => {
    const g = await model();
    expect(g.nodes.length).toBeGreaterThan(0);
    const ids = g.nodes.map((n) => n.id);
    expect([...ids].sort()).toEqual(ids); // already sorted
    const member = g.nodes.find((n) => n.id === "Member");
    expect(member).toBeDefined();
    expect(member!.propertyCount).toBeGreaterThan(0);
  });

  it("emits one relation per link type carrying cardinality and endpoints", async () => {
    const g = await model();
    const attended = g.relations.find((r) => r.id === "attended");
    expect(attended).toMatchObject({
      source: "Member",
      target: "Event",
      cardinality: "many-to-many",
    });
  });

  it("attaches actions to their primary target with the agent policy", async () => {
    const g = await model();
    const checkIn = g.actions.find((a) => a.id === "check_in");
    expect(checkIn).toBeDefined();
    expect(checkIn!.policy).toBe("always_confirm");
    // check_in has a ref param `booking` → Booking; primaryTarget falls back to it
    expect(checkIn!.primaryTarget).toBe("Booking");
    expect(checkIn!.permissions).toContain("steward");

    const claim = g.actions.find((a) => a.id === "claim_shift");
    expect(claim!.policy).toBe("auto_apply");
  });

  it("derives create/update/delete/read effects from the action declaration", () => {
    const synthetic = ontologyToGraph({
      properties: {},
      roles: {},
      object_types: {
        A: { properties: { id: { type: "uuid", primary_key: true } } },
        B: { properties: { id: { type: "uuid", primary_key: true } } },
      },
      link_types: {},
      action_types: {
        make_a: {
          creates_object: "A",
          parameters: { ref_b: { type: "ref", target: "B" } },
          agent_policy: "auto_apply",
        },
      },
    } as never);
    const act = synthetic.actions[0];
    expect(act.primaryTarget).toBe("A");
    expect(act.targets).toEqual(
      expect.arrayContaining([
        { objectType: "A", effect: "creates" },
        { objectType: "B", effect: "reads" },
      ]),
    );
  });

  it("is deterministic — same input yields identical output", async () => {
    const o = await loadOntology(getRuntimeOntologyDir());
    expect(ontologyToGraph(o)).toEqual(ontologyToGraph(o));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec acropolisos-app npx vitest run lib/graph/derive.test.ts`
Expected: FAIL — `Cannot find module './derive'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/graph/derive.ts
// Pure projection of the loaded ontology into a render-agnostic graph model.
// Nodes = object types; relations = link types; actions = action types attached
// to the object they primarily touch, carrying the agent_policy verification
// contract. No I/O — feed it the result of loadOntology().
import type {
  Ontology,
  AgentPolicy,
  SideEffectChannel,
  PropertyDefinition,
} from "../ontology/schema";

export interface GraphNode {
  id: string;
  label: string;
  titleProperty: string | null;
  propertyCount: number;
  readRoles: string[];
  writeRoles: string[];
}

export interface GraphRelationEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  cardinality: string;
}

export type ActionEffect = "creates" | "updates" | "deletes" | "reads";

export interface GraphActionTarget {
  objectType: string;
  effect: ActionEffect;
}

export interface GraphAction {
  id: string;
  label: string;
  policy: AgentPolicy;
  permissions: string[];
  sideEffects: SideEffectChannel[];
  primaryTarget: string | null;
  targets: GraphActionTarget[];
  createsLink: string | null;
}

export interface GraphModel {
  nodes: GraphNode[];
  relations: GraphRelationEdge[];
  actions: GraphAction[];
}

function refTarget(prop: PropertyDefinition): string | null {
  return "type" in prop && prop.type === "ref" ? prop.target : null;
}

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

export function ontologyToGraph(ontology: Ontology): GraphModel {
  const nodes: GraphNode[] = Object.entries(ontology.object_types)
    .map(([id, ot]) => ({
      id,
      label: id,
      titleProperty: ot.title_property ?? null,
      propertyCount: Object.keys(ot.properties).length,
      readRoles: ot.permissions?.read ?? [],
      writeRoles: ot.permissions?.write ?? [],
    }))
    .sort(byId);

  const relations: GraphRelationEdge[] = Object.entries(ontology.link_types)
    .map(([id, lt]) => ({
      id,
      source: lt.from,
      target: lt.to,
      label: id,
      cardinality: lt.cardinality,
    }))
    .sort(byId);

  const actions: GraphAction[] = Object.entries(ontology.action_types)
    .map(([id, at]) => {
      const targets: GraphActionTarget[] = [];
      if (at.creates_object) targets.push({ objectType: at.creates_object, effect: "creates" });
      if (at.updates) targets.push({ objectType: at.updates, effect: "updates" });
      if (at.deletes) targets.push({ objectType: at.deletes, effect: "deletes" });
      for (const prop of Object.values(at.parameters ?? {})) {
        const t = refTarget(prop);
        if (t) targets.push({ objectType: t, effect: "reads" });
      }
      const primaryTarget =
        at.creates_object ??
        at.updates ??
        at.deletes ??
        targets.find((t) => t.effect === "reads")?.objectType ??
        null;
      return {
        id,
        label: id,
        policy: at.agent_policy,
        permissions: at.permissions ?? [],
        sideEffects: at.side_effects ?? [],
        primaryTarget,
        targets,
        createsLink: at.creates_link ?? null,
      };
    })
    .sort(byId);

  return { nodes, relations, actions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec acropolisos-app npx vitest run lib/graph/derive.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check and commit**

Run: `docker exec acropolisos-app npx tsc --noEmit` → no errors.

```bash
git add lib/graph/derive.ts lib/graph/derive.test.ts
git commit -m "feat(acropolisos): ontologyToGraph — pure projection of ontology to graph model"
```

---

### Task 2: Install graph dependencies

**Files:**
- Modify: `package.json` (via container install)

- [ ] **Step 1: Install inside the container**

Run: `docker exec acropolisos-app npm install @xyflow/react @dagrejs/dagre`
Expected: both added to `dependencies` in the bind-mounted `package.json`; no peer-dep errors against React 19 (`@xyflow/react` v12+ supports React 19).

- [ ] **Step 2: Verify resolution**

Run: `docker exec acropolisos-app node -e "require.resolve('@xyflow/react'); require.resolve('@dagrejs/dagre'); console.log('ok')"`
Expected: prints `ok`.

> If `@xyflow/react` reports a React 19 peer warning that blocks install, re-run with the documented flag for this repo's npm version and confirm the version via context7 (`resolve-library-id` → `@xyflow/react`) before proceeding. Do NOT use `--force` blindly.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(acropolisos): add @xyflow/react + @dagrejs/dagre for graph view"
```

---

### Task 3: Pure dagre layout helper

**Files:**
- Create: `lib/graph/layout.ts`
- Test: `lib/graph/layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/graph/layout.test.ts
import { describe, it, expect } from "vitest";
import { layoutGraph } from "./layout";
import type { GraphModel } from "./derive";

const model: GraphModel = {
  nodes: [
    { id: "A", label: "A", titleProperty: null, propertyCount: 1, readRoles: [], writeRoles: [] },
    { id: "B", label: "B", titleProperty: null, propertyCount: 1, readRoles: [], writeRoles: [] },
  ],
  relations: [{ id: "rel", source: "A", target: "B", label: "rel", cardinality: "one-to-many" }],
  actions: [],
};

describe("layoutGraph", () => {
  it("assigns a finite position to every node", () => {
    const positioned = layoutGraph(model);
    expect(positioned).toHaveLength(2);
    for (const n of positioned) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it("separates connected nodes (A above/left of B in a DAG)", () => {
    const positioned = layoutGraph(model);
    const a = positioned.find((n) => n.id === "A")!;
    const b = positioned.find((n) => n.id === "B")!;
    expect(a.x !== b.x || a.y !== b.y).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec acropolisos-app npx vitest run lib/graph/layout.test.ts`
Expected: FAIL — `Cannot find module './layout'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/graph/layout.ts
// Pure dagre layout: GraphModel relations form the DAG; returns x/y per node.
// Action chips are positioned client-side relative to their primaryTarget, so
// only object nodes + relations participate in the dagre pass.
import dagre from "@dagrejs/dagre";
import type { GraphModel } from "./derive";

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

const NODE_W = 180;
const NODE_H = 64;

export function layoutGraph(model: GraphModel): PositionedNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of model.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const r of model.relations) {
    if (g.hasNode(r.source) && g.hasNode(r.target)) g.setEdge(r.source, r.target);
  }

  dagre.layout(g);

  return model.nodes.map((n) => {
    const pos = g.node(n.id);
    // dagre centers nodes; React Flow positions by top-left corner.
    return { id: n.id, x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec acropolisos-app npx vitest run lib/graph/layout.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/graph/layout.ts lib/graph/layout.test.ts
git commit -m "feat(acropolisos): pure dagre layout for the ontology graph"
```

---

### Task 4: Policy theme tokens + Legend component

**Files:**
- Modify: `app/globals.css` (add three named policy color vars under `.dark` and `@theme inline`)
- Create: `components/graph/legend.tsx`

- [ ] **Step 1: Add policy color tokens to globals.css**

In the `.dark` block, add (oklch, consistent with the warm-earthy base):
```css
  --policy-auto: oklch(0.7 0.15 150);      /* green  — AI runs autonomously */
  --policy-familiar: oklch(0.78 0.14 80);  /* amber  — confirm if unfamiliar */
  --policy-confirm: oklch(0.62 0.2 28);    /* red    — always confirm */
```
In the `@theme inline` block, expose them:
```css
  --color-policy-auto: var(--policy-auto);
  --color-policy-familiar: var(--policy-familiar);
  --color-policy-confirm: var(--policy-confirm);
```

- [ ] **Step 2: Write the Legend component**

```tsx
// components/graph/legend.tsx
import type { AgentPolicy } from "@/lib/ontology/schema";

export const POLICY_LABEL: Record<AgentPolicy, string> = {
  auto_apply: "AI runs autonomously",
  confirm_if_unfamiliar: "AI confirms if unfamiliar",
  always_confirm: "AI always confirms with a human",
};

export const POLICY_VAR: Record<AgentPolicy, string> = {
  auto_apply: "var(--color-policy-auto)",
  confirm_if_unfamiliar: "var(--color-policy-familiar)",
  always_confirm: "var(--color-policy-confirm)",
};

export function Legend(): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card/90 p-3 text-xs text-muted-foreground backdrop-blur">
      <p className="mb-2 font-medium text-foreground">What the AI may do</p>
      <ul className="space-y-1">
        {(Object.keys(POLICY_LABEL) as AgentPolicy[]).map((p) => (
          <li key={p} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: POLICY_VAR[p] }} />
            {POLICY_LABEL[p]}
          </li>
        ))}
      </ul>
      <p className="mt-3 mb-1 font-medium text-foreground">Edges</p>
      <ul className="space-y-1">
        <li>— solid: relation between objects</li>
        <li>– – dashed: action mutates an object</li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Type-check and commit**

Run: `docker exec acropolisos-app npx tsc --noEmit` → no errors.

```bash
git add app/globals.css components/graph/legend.tsx
git commit -m "feat(acropolisos): policy color tokens + graph legend"
```

---

### Task 5: OntologyGraph client renderer (objects + relations + action chips)

**Files:**
- Create: `components/graph/ontology-graph.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/graph/ontology-graph.tsx
// Client React Flow renderer for the ontology graph. Object types are nodes
// (positioned by the pure dagre pass), link types are solid edges, and action
// types render as small policy-colored chips inside the object they primarily
// touch. Clicking a node opens the inspector. Read-only.
"use client";

import { useMemo, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphModel, GraphAction } from "@/lib/graph/derive";
import { layoutGraph } from "@/lib/graph/layout";
import { POLICY_VAR } from "./legend";
import { Legend } from "./legend";
import { Inspector } from "./inspector";

interface ObjectNodeData extends Record<string, unknown> {
  label: string;
  propertyCount: number;
  actions: GraphAction[];
}

function ObjectNode({ data }: NodeProps<Node<ObjectNodeData>>): React.ReactElement {
  return (
    <div className="min-w-[160px] rounded-md border border-border bg-card px-3 py-2 shadow-sm">
      <div className="text-sm font-medium text-foreground">{data.label}</div>
      <div className="text-[10px] text-muted-foreground">{data.propertyCount} properties</div>
      {data.actions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {data.actions.map((a) => (
            <span
              key={a.id}
              title={`${a.id} — ${a.policy} (${a.permissions.join(", ") || "no roles"})`}
              className="rounded px-1.5 py-0.5 text-[9px] font-medium text-background"
              style={{ backgroundColor: POLICY_VAR[a.policy] }}
            >
              {a.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { object: ObjectNode };

export function OntologyGraph({ model }: { model: GraphModel }): React.ReactElement {
  const [selected, setSelected] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const positions = new Map(layoutGraph(model).map((p) => [p.id, p]));
    const actionsByTarget = new Map<string, GraphAction[]>();
    for (const a of model.actions) {
      if (!a.primaryTarget) continue;
      const list = actionsByTarget.get(a.primaryTarget) ?? [];
      list.push(a);
      actionsByTarget.set(a.primaryTarget, list);
    }
    const nodes: Node<ObjectNodeData>[] = model.nodes.map((n) => ({
      id: n.id,
      type: "object",
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: { label: n.label, propertyCount: n.propertyCount, actions: actionsByTarget.get(n.id) ?? [] },
    }));
    const edges: Edge[] = model.relations.map((r) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      label: `${r.label} (${r.cardinality})`,
      labelStyle: { fill: "var(--color-muted-foreground)", fontSize: 10 },
      style: { stroke: "var(--color-border)" },
    }));
    return { nodes, edges };
  }, [model]);

  const onNodeClick = useCallback((_: unknown, node: Node) => setSelected(node.id), []);
  const selectedNode = model.nodes.find((n) => n.id === selected) ?? null;
  const selectedActions = model.actions.filter((a) => a.primaryTarget === selected);

  return (
    <div className="h-[calc(100vh-3rem)] w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--color-border)" gap={20} />
        <Controls />
        <Panel position="top-left"><Legend /></Panel>
        {selectedNode && (
          <Panel position="top-right">
            <Inspector node={selectedNode} actions={selectedActions} onClose={() => setSelected(null)} />
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `docker exec acropolisos-app npx tsc --noEmit`
Expected: errors only about the not-yet-created `./inspector` import (resolved in Task 6). If other type errors appear, fix them. (Do NOT commit until Task 6 makes tsc clean.)

---

### Task 6: Inspector panel

**Files:**
- Create: `components/graph/inspector.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/graph/inspector.tsx
"use client";

import { X } from "lucide-react";
import type { GraphNode, GraphAction } from "@/lib/graph/derive";
import { POLICY_VAR, POLICY_LABEL } from "./legend";

export function Inspector({
  node,
  actions,
  onClose,
}: {
  node: GraphNode;
  actions: GraphAction[];
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="w-64 rounded-lg border border-border bg-card p-3 text-sm shadow-lg">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">{node.label}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between"><dt>Properties</dt><dd className="text-foreground">{node.propertyCount}</dd></div>
        <div className="flex justify-between"><dt>Read</dt><dd className="text-foreground">{node.readRoles.join(", ") || "—"}</dd></div>
        <div className="flex justify-between"><dt>Write</dt><dd className="text-foreground">{node.writeRoles.join(", ") || "—"}</dd></div>
      </dl>
      {actions.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Actions on this object</p>
          <ul className="space-y-1.5">
            {actions.map((a) => (
              <li key={a.id} className="text-xs">
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: POLICY_VAR[a.policy] }} />
                  {a.label}
                </span>
                <span className="block pl-3.5 text-[10px] text-muted-foreground">
                  {POLICY_LABEL[a.policy]} · {a.permissions.join(", ") || "no roles"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check and commit (Tasks 5+6 together)**

Run: `docker exec acropolisos-app npx tsc --noEmit` → no errors.

```bash
git add components/graph/ontology-graph.tsx components/graph/inspector.tsx
git commit -m "feat(acropolisos): ontology graph renderer + node inspector"
```

---

### Task 7: `/graph` route + left-nav entry

**Files:**
- Create: `app/graph/page.tsx`
- Modify: `components/shell/left-nav.tsx`

- [ ] **Step 1: Write the route (RSC)**

```tsx
// app/graph/page.tsx
// Server component: load the SAME ontology the running app uses, project it to
// a graph model, and hand it to the client renderer. Pure read; no auth gate
// needed — the ontology shape is not member data.
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { ontologyToGraph } from "@/lib/graph/derive";
import { OntologyGraph } from "@/components/graph/ontology-graph";

export const dynamic = "force-dynamic";

export default async function GraphPage(): Promise<React.ReactElement> {
  const ontology = await loadOntology(getRuntimeOntologyDir());
  const model = ontologyToGraph(ontology);
  return <OntologyGraph model={model} />;
}
```

- [ ] **Step 2: Add the nav entry**

In `components/shell/left-nav.tsx`, add a link to `/graph` labeled "Graph" alongside the existing nav items (match the existing item markup and the `lucide-react` icon pattern already used there — use the `Workflow` or `Share2` icon). Follow the exact className pattern of the sibling links; do not introduce new styling.

- [ ] **Step 3: Restart container (new route dir) and type-check**

Run: `docker restart acropolisos-app` (a brand-new `app/graph/` route dir may not be picked up by the running dev server).
Run: `docker exec acropolisos-app npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add app/graph/page.tsx components/shell/left-nav.tsx
git commit -m "feat(acropolisos): /graph route + left-nav entry"
```

---

### Task 8: Full test run + in-browser verification

- [ ] **Step 1: Run the full graph test suite**

Run: `docker exec acropolisos-app npx vitest run lib/graph/`
Expected: all pass (Task 1: 5, Task 3: 2).

- [ ] **Step 2: tsc clean**

Run: `docker exec acropolisos-app npx tsc --noEmit` → no errors.

- [ ] **Step 3: Browser verification (Chrome MCP, steward account)**

Navigate to http://localhost:3030/graph (sign in steward@acropolisos.local / acropolis2026 if prompted). Verify:
- All 13 object nodes render and are laid out (not stacked at 0,0).
- Relation edges show labels with cardinality (e.g. `attended (many-to-many)`).
- Action chips appear inside their target nodes, colored: `claim_shift` green, `check_in` amber/red per its policy.
- The Legend panel (top-left) explains the three policy colors.
- Clicking a node opens the Inspector (top-right) with properties, permissions, and that node's actions; close button works.
- Pan/zoom/fit-view work; no console errors.

Report verification with a screenshot. Do NOT instruct the user to test — verify silently via Chrome tools, fix anything broken, re-verify.

---

## Self-Review (plan author)

- **Spec coverage:** nodes (T1), relations w/ cardinality (T1), action policy coloring (T1+T4+T5), legend (T4), inspector (T6), route using the live ontology root (T7), nav entry (T7), React Flow + read-only (T5), browser verify (T8). Covered.
- **Placeholder scan:** every code step has complete code; the only prose-only step is the nav-entry edit (T7 S2), which is a one-line insertion into an existing file whose exact markup the implementer must match — kept as instruction to avoid guessing sibling classNames.
- **Type consistency:** `GraphModel`/`GraphNode`/`GraphAction` defined in T1 and consumed unchanged in T3/T5/T6; `POLICY_VAR`/`POLICY_LABEL`/`AgentPolicy` keys (`auto_apply`/`confirm_if_unfamiliar`/`always_confirm`) consistent across T4/T5/T6 and match `lib/ontology/schema.ts`.
