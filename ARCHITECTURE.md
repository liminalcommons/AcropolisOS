# acropolisOS — Architecture Direction

**Status:** direction note (decisions stabilized 2026-05-24). Supersedes ad-hoc framing in the storyboard + the dense design spec for *architecture* questions. The storyboard (`.chora/artifacts/2026-05-23-acropolisos-manager-storyboard.html`) is the UX contract; this note is the structural contract.

---

## 1. Thesis — why this is not "just a coding agent"

acropolisOS is **a persistent, multi-user, governed habitat where an organization's operational life lives** — not a tool you invoke and leave. A coding agent edits a dead repo. acropolisOS holds a live world-model with real rows, real logged-in people, and accumulating real use, and reshapes itself *from within* under governance.

The differentiator is anchored in **living state**, which a stateless coding agent structurally cannot touch:
- Editing the world-model means **migrating real data under live multi-user load**, not changing dead text.
- Operators are **non-technical and plural** (manager + front-desk + work-trader), each with their own lens.
- The system **observes accumulated use and proposes its own evolution**; humans approve, they don't author.

If we stop at "agent edits YAML → codegen rebuilds," the critique is correct and the moat is zero. The product **is** the habitat layer.

---

## 2. The layer fence (the load-bearing boundary)

```
GOVERNED CORE  — the coding/view agent NEVER touches this
  world-model · assimilation pipeline · ontology · auth · n8n actions
        │  exposes a strictly READ-ONLY, ontology-typed query API
        ▼
VIEW LAYER  — the agent's entire world
  dashboards / widgets / visualizations
  reads the world-model, renders it. Cannot write data, change schema, or touch core.
```

**The coding/view agent is a read-only view generator.** Worst case it produces a bad-looking panel — bounded blast radius. Because it never has write capability, it *cannot* corrupt data or schema. This removes the need for a heavy worktree→test→approve→rebuild pipeline for views.

---

## 3. The core spine — the Assimilation Pipeline

The one component that justifies the product. Turns whatever a human throws in into coherent, typed world-model state.

1. **Ingest** — messy row lands. *(built: `raw_inbox`, file drop, `/connect`)*
2. **Classify** — LLM maps row → ontology type + field mapping. *(F4 narrates this, never commits — currently faked)*
3. **Resolve** — entity resolution / dedup against existing rows ("Marta López" == "Marta Lopez"?). **Hard part. Moat.**
4. **Evolve** — when data doesn't fit, propose an ontology change (new field/type). Goes through the **governed ontology path**, *not* the view agent.
5. **Commit** — write typed row(s) with provenance (`raw_inbox.classified_as/at/by` columns already exist, unwired).
6. **Reconcile** — ambiguity surfaces the 3-scenario chooser (F7's pattern, reused).

**The moat is steps 3 + 4** — both require the persistent shared world-model; a stateless agent has nothing to resolve against or migrate.

**Minimum viable spine** (closes the loop, kills the F4 fake): one source · classify into *existing* types only · dedup by near-match on one key field · human confirms every mapping before commit · provenance recorded. Defer step-4 ontology-evolution to phase 2.

---

## 4. The three organs + routing

The orchestrator agent (Mastra/AI-SDK) is the control plane. It routes by the **nature of the change**, over an MCP/tool bus:

| Change is about… | Organ | Shape | Live-safe? |
|---|---|---|---|
| **State** — "a fact changed" | direct DB tools | data | ✅ |
| **Behavior** — "when X, do Y" | n8n (REST/MCP) | workflow JSON | ✅ |
| **Structure** — "the model must differ" | ontology YAML → codegen | data | ✅ (migrates rows) |
| **View** — "show it differently" | view agent (widgets) | config + rare custom code | ✅ (read-only) |

**Critical asymmetry:** n8n, ontology, and widget changes are all *data/config the running system reads* → live-safe. Real source-code edits would cross a rebuild boundary. **Therefore: express everything possible as data/config; never let the agent edit core source.** The ontology/codegen spine is what collapses would-be code changes onto the live-safe side (Axiom 2: Spec → Factory → Linter).

---

## 5. The view layer — widgets, not freeform code

**Composition over generation.** The agent's job is "pick widget → bind to a world-model query → set config" — form-filling, not coding. Predictable, instant, cacheable, safe (widgets vetted once, reused forever).

```
Widget catalog (pre-set)   → curated widgets the agent SELECTS         (~95%)
Custom widget (escape hatch) → agent GENERATES a one-off, iframe-sandboxed, read-only  (~5%)
```

Extends what F6 already shipped: `WIDGET_KINDS` + `WidgetBundle` + `PinnedWidget` renderer + persistence in `MemberContext.pinned_widgets`. Grow the catalog: `bed_grid`, `calendar`, `kanban`, `table`, `metric`, `timeline`, `chart`, `roster`…

Each catalog entry = `{ component, configSchema, queryBinding }`. Agent tool `compose_dashboard(selections)` writes to `pinned_widgets`.

### The "everything is data" unification

| Concern | Shape | Live-safe |
|---|---|---|
| Automations | n8n workflow JSON | ✅ |
| Structure | ontology YAML | ✅ |
| Dashboards | widget selection + config | ✅ |
| **Custom widget** | generated component | **code (iframe sandbox) — rare** |

---

## 6. Stack & visual language (settled)

- **shadcn + Tailwind** — the substrate. Themeable blank canvas (you own the look) + **most agent-reliable** (training-data density → agent-composed UI comes out correct). Do NOT adopt Blueprint: its enterprise blue-grey aesthetic is baked into the components, only partially re-skinnable, and the wrong feeling for non-technical users.
- **TanStack Table** (headless) — dense-grid muscle, styled to match. Use *underneath* shadcn cells when a grid needs virtualization/grouping/faceting. Gives Palantir-grade data density without Palantir's face.
- **react-grid-layout** — draggable/resizable dashboard canvas (design-system-agnostic) if/when needed.
- **Visual language = calm-prosumer (Linear / Notion / Vercel), NOT enterprise-dense.** Calm shell, dense data: chrome is quiet (whitespace, typography-led, restrained palette, semantic color used sparingly); density lives *inside* each clean self-contained widget. Define a token system (palette · type scale · spacing rhythm · semantic-color rules) once so every agent-composed widget inherits the same calm and per-org skins stay coherent.
- ⚠️ **Palantir OSDK** (`@osdk/*`) is a Foundry *client* SDK, not a standalone ontology engine — a name-trap, unusable for self-hosted acropolisOS.

---

## 7. Contracts & rules

- **Read-only data API**: the view layer consumes a scoped, ontology-typed, read-only query interface over the world-model. The agent knows what it can query (typed from the ontology); it physically cannot write.
- **View-isolation slot**: custom widgets render in an iframe sandbox (`sandbox="allow-same-origin"`, no `allow-scripts` for static; tighter for untrusted). Catalog widgets are vetted components, hot-loaded.
- **Escalation rule**: the view agent renders *only what is modeled*. A request needing unmodeled data ("guests by nationality" when `nationality` isn't a field) must **escalate to the assimilation/ontology path** (governed, human-approved) — the agent must NOT invent the field. *Views draw windows; only the governed pipeline pours foundation.*

---

## 8. Honest build status (2026-05-24)

**Real:** dashboard reads live hostel seed · file drop → `raw_inbox` · F7 creates an n8n workflow · n8n container provisioned + locked to localhost · agent has read/create n8n tools.

**Faked / missing (the actual remaining product):**
- Assimilation pipeline never closes — F4 narrates, never commits typed rows (step 2/3/5 unbuilt).
- n8n workflows F7 creates are empty manual-trigger stubs — no real action nodes.
- **Per-user ontological slices never built** — dashboard hardcoded to manager view. This is the thesis; it's the missing piece.
- Data was hand-seeded, not user-ingested. BYOK key stubbed.

**Next focused build (no loop, TDD):** the minimum assimilation spine (§3) — that single thing turns F4 from theater into the product.
