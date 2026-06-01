# acropolisOS M3 — Autonomous Community Intelligence — Design Spec

**Date:** 2026-05-26
**Status:** As-built (retroactive). The capability is shipped, verified, and green; this document is the design contract the build was executed against, reconstructed from the committed code.
**Thesis:** *The machine does the work and proposes; the human disposes.* The agent auto-applies low-stakes actions and, at every judgment call or risk, surfaces **up to three governed scenarios** for a human to pick — and the community's accumulated choices re-rank what the agent proposes next, all measured by five honest KPIs.
**Source context:** package `packages/acropolisos` (repo `AcropolisOS.git`, published on `main`; developed on the monorepo's `feat/acropolisos-ui-rework`). Stack: Next.js (App Router) + Postgres + Drizzle + Mastra/AI-SDK; one-command `docker-compose up` → `http://localhost:3030`.

> **House note.** This spec follows the same governed-substrate house style as `2026-05-25-acropolisos-ui-rework-design.md` ("the shell is invariant; the skin and contents vary only within a governed vocabulary"). M3 is the same principle applied to *decisions and autonomy*: the governed core is invariant; what the agent does and proposes varies only within a governed vocabulary, never by authoring new structure or new write paths.

---

## 1. Context & reframing — from "society simulation" to "autonomous governed habitat"

The grant deliverable was originally framed as a **society simulation**: a sandbox of hundreds of agents acting out a community. That framing was abandoned, on principle, for a stronger one. A simulation is a *toy model of* a community; what we built is the *operating substrate for* a real one.

**The reframe:** acropolisOS is a **universal, governed habitat**. A community describes itself once as a typed ontology — object types, fields, permissions, action types with policies — and the system runs its operational life. M3 adds the **autonomy layer** on top of that substrate: the agent does most of the operational work itself, and at every judgment call escalates a small, governed decision to a human. This is a more complete and more defensible deliverable than a swarm of puppet agents, because the autonomy is *real* (it runs the actual world-model pipeline against live Postgres) and *governed* (every act passes the same permission and policy fence as a human action).

This was a deliberate **from-scratch rebuild**, disconnected from M1 (the Discord/LightRAG bot) and M2 (the Cognee/Sentinel/Arbitor microservices). The milestone theme — *autonomous community general intelligence* — is a genuine architectural leap, and bolting autonomy onto a chat bot would have produced a demo, not a substrate.

### The substrate thesis

Everything M3 surfaces is a pure function of the world-model and the viewer — never a hand-authored screen:

```
board = render(ontology, data, viewer, approved_views)
```

- **ontology** — the loaded community description (object types, fields, permissions, action policies). The vocabulary.
- **data** — live rows in Postgres.
- **viewer** — the actor and their role; determines what is readable and what affordances appear.
- **approved_views** — the governed widget vocabulary (the catalog) plus any pinned/approved compositions.

The agent's job is *composition over generation*: pick a widget kind, supply a config, let the catalog drive the read. It never writes a bespoke SQL query, never hand-codes a page, and never invents a structure. **The machine proposes a composition; the governed fence disposes of whether it is allowed.** The same render function, given a different viewer, yields a different board — which is exactly how the steward's home and a member's home differ without any per-role page being written (see `lib/widgets/derive-board.ts`, `lib/widgets/read-api.ts#buildCanReadType`).

M3 extends this thesis from *views* to *decisions*: an escalation is `render(ontology, situation, viewer)` over the `agent_blocker` vocabulary, and a resolution is a governed action dispatched through the same policy + permission fence as any other.

---

## 2. The ≤3-scenario decision primitive

When the agent reaches a judgment call it cannot or should not auto-decide, it does not act and it does not invent a voting subsystem. It raises a **governed escalation** — an `AgentBlocker` row — that surfaces **up to three curated pathways** for a human to choose among. This is the atomic unit of "agent-driven collective decision-making" (deliverable #3): the agent surfaces the options; the community's governance (the steward, acting on the community's behalf) disposes.

### `agent_blocker` — the typed escalation

Defined in `ontology/object-types/agent-blocker.yaml`. Key facts the build relies on:

- It is **the only object the `flag_blocker` action writes**; humans never edit the row directly — they `resolve_blocker_with_pathway`, `resolve_blocker_with_input`, `resolve_blocker_with_custom`, or `dismiss_blocker`.
- `read`/`write` permissions are `["steward", "member_self"]` — so the queue, and everything computed from it, is fail-closed to the steward and the blocked actor (see §4, §6).
- `reason_kind` is a 7-value enum `[approval, confirmation, ambiguity, missing_data, consent, decision, risky_action]` — the situation taxonomy that keys the self-correction loop (§8).
- `resolution_mode` drives the human-input shape: **`pathways`** (the agent's curated paths), **`text_input`** (human supplies missing data), or **`confirm_binary`** (yes/no on one proposed action). `pathways` is the default.
- `pathways` is a JSON array (DB column `jsonb`); the schema allows **N ≥ 1, ≤ 5**. The **"≤3" is a curation discipline**, not a schema cap: a clean decision surface offers the human a small, comprehensible set. The demo (§9) raises exactly three.
- `status` is `[open, resolved, dismissed, expired]` (default `open`). An open row sits in the **veto-queue**; the closed states feed the KPIs.
- `resolved_via_pathway_id` records *which* pathway the human picked — the training signal the self-correction loop reads.

Each pathway element is `{ id, label, rationale, action: { type, params }, reversibility: easy|moderate|permanent }`. `reversibility` is load-bearing for safety ordering (§8).

### auto_apply vs always_confirm — the policy gate

Every action type carries an `agent_policy` in its ontology YAML, and the gate is enforced by the real `resolveActionPolicy` on every invocation:

- **`auto_apply`** — the agent executes it unaided, no human confirmation. Low-stakes, ontology-declared safe. Examples: `log_incident`, `flag_blocker`, `claim_shift`, `mark_notification_read`.
- **`always_confirm`** — the action cannot execute without an explicit human confirm. The agent leg returns `confirmation_required: { reason: "always_confirm" }`; only a server-set `bypassConfirmation: true` (what `app/api/chat/confirm/route.ts` sets *after* the human clicks Confirm) lets it through. Examples: `resolve_blocker_with_pathway`, `check_in`, `check_out`, `dismiss_blocker`, `change_tier`, `promote_to_steward`.

Note the deliberate asymmetry that makes the primitive coherent: **`flag_blocker` is itself `auto_apply`** (the agent is always allowed to *raise* a question), while **resolving** a blocker is `always_confirm` (a human must dispose). Raising is autonomous; deciding is human.

---

## 3. The layer fence — governed core vs. read-only view layer

The architecture is split into a **governed core** the view-agent may never write, and a **read-only, permission-aware view layer** the agent composes within. The fence is structural (enforced by the type system and the permission model), not advisory. **Fail-closed is the default everywhere.**

### The governed core (the view-agent never writes it)

- **World-model + ontology** — object types, fields, the typed write surface `ctx.objects.*`, and the action types with their policies. Mutations flow only through permission-checked `ctx.objects` and the action dispatcher (`createInProcessDispatcher` → `invokeAction` → permission check → function-backed handler).
- **Auth / permissions** — `lib/ontology/ctx.ts` is the single permission model. `createCtx` wraps **every** type the store exposes (`wrap()` over `Object.keys(db.objects)`) — no type can skip the fence. `wrapObjectAccess` **fails closed**: a type with no permissions entry returns a deny-all wrapper (reads → `null`/`[]`, writes → `PermissionError`). The allow-all `["*"]` is the *only* public shorthand; an empty or absent token list means "no one is permitted," never "public" (`actorMatchesTokens`). The `member_self` token resolves per-row ownership (`rowOwnedBy` probes `user_id`/`owner_id`/`owner`/`recipient_member_id`/`blocked_actor_id`/`member_id`, scoped to avoid false positives). This file is sacred — the entire view layer borrows its semantics and never re-implements them.

### The read-only, permission-aware view layer (where the agent lives)

- The agent composes views by choosing a **catalog widget kind** and supplying a config; the catalog drives the read (`lib/widgets/catalog.ts`). Every `queryBinding` receives a **`ReadOnlyDataApi`, never the raw db handle** — it *physically cannot* call `db.insert/update/delete`. The interface (`lib/widgets/read-api.ts#ReadOnlyDataApi`) has no mutation member; a value of that type cannot write. This is a type-level guarantee, not a convention.
- `createReadOnlyDataApi(db, canReadType, ontology)` is the single chokepoint where SELECT SQL for the widget path lives. It enforces, **before any SQL runs**:
  - (a) **type membership** — validated against `deriveVocabulary(ontology).validTypes` *and* a real entry in the generated `TABLES` registry (`resolveType` guards ontology↔schema drift). Unknown → safe-empty.
  - (b) **per-actor read permission** — `canReadType` reuses the **same** `buildObjectPermissionsMap` + `actorMatchesTokens` semantics as `ctx.objects`. One permission model, not two. A viewer not permitted gets the identical safe-empty value an unknown type returns.
  - (c) **field whitelist** — columns/date-fields validated against `deriveVocabulary().validFields`; unknowns dropped.
  - (d) **bound parameters** — limits and filter values are SQL parameters, never interpolated; table names come from `getTableName(tableFor(resolved))` (the same `TABLES` object the gate keys on), never reconstructed from the token string.
  - (e) **SELECT-only** — no insert/update/delete anywhere in the file.

The agent knows what it *can* query (typed from the ontology) and physically cannot write. The view layer is a projection of *whatever* ontology is loaded, with zero domain literals — which is what lets a non-hostel community boot the same code unchanged.

---

## 4. Deliverable map

The six M3 deliverables, each with its as-built realization and the acceptance criteria the build satisfied.

### D1 — Design document (originally "society simulation")
**As built:** reframed as the autonomous governed habitat and specified in *this* document — thesis, the ≤3-scenario decision primitive, the layer fence, the deliverable map, and acceptance criteria per build.
**Acceptance:** this spec exists, grounded in the committed code, and is the contract the implementation was executed against.

### D2 — Prototype: hundreds of agents, each with a rudimentary KB
**As built:** `scripts/seed-scale-community.ts` deterministically populates **300 `Member` rows**, each with a 1:1 `MemberContext` carrying a small **valid** catalog-widget knowledge base (`pinned_widgets`). Each member-context is the agent's per-member context slice.
**Governance:** every generated KB descriptor is validated against the widget catalog at generation time via `validateWidgetConfig` (fail-closed, ontology-derived membership + field whitelist) — the generator *cannot* persist a malformed KB; an invalid preset aborts the seed before any DB write.
**Acceptance:** `SCALE ACCEPTANCE PASS: 300 members, 300 contexts` on two consecutive runs (idempotent, tagged `%@scale.local`); real members untouched; 1:1 member↔context correspondence asserted.

### D3 — Agent-driven collective decision-making
**As built:** the agent detects a situation and raises a governed `agent_blocker` offering up to 3 curated pathways; the steward disposes on the community's behalf via the real `always_confirm → confirm` path. The decision *surface* (veto-queue + pathway / binary / text resolvers) is the shipped foundation; there is no fabricated voting subsystem — surface-then-decide *is* the collective-decision contract.
**Acceptance:** `scripts/demo-m3-narrative.ts` exercises the full pipeline and asserts each step against ground-truth DB state, printing `=== M3 DEMO NARRATIVE PASS ===` reproducibly (idempotent, tag-scoped). Key code: `functions/flag-blocker.ts`, `functions/resolve-blocker-with-pathway.ts`, `ontology/object-types/agent-blocker.yaml`.

### D4 — Integrating real human input
**As built:** three governed human-input affordances, all derived (not hand-coded) and all flowing through the fail-closed fence:
- **pathway picker** — choose among ≤3 scenarios (`resolution_mode: pathways`; `resolve_blocker_with_pathway`, whose `row_resolver` binds the chosen pathway id to the `pathway_id` param).
- **binary confirm** — yes/no on one proposed action (`resolution_mode: confirm_binary`).
- **text input** — supply missing data (`resolution_mode: text_input`).

Plus the `compose_view` chat for shaping the board. `always_confirm` actions cannot execute without a server-set `bypassConfirmation` (injection-safe; the server, not the client, sets it).
**Acceptance:** the gated leg returns `confirmation_required:always_confirm`; the confirm leg (with `bypassConfirmation:true`) succeeds and flips the row — both asserted in the demo (Step 3). Key code: `functions/resolve-blocker-with-pathway.ts`, `app/api/chat/route.ts`, `app/api/chat/confirm/route.ts`.

### D5 — Self-correction using human feedback
**As built:** `lib/blockers/pathway-preference.ts` reads the community's recorded pathway choices (`resolved_via_pathway_id`) per `reason_kind` and re-ranks the pathways future blockers offer — **safest-reversibility-first, then accumulated preference** (see §8). Wired into `flag_blocker`, so every new escalation reflects what the community has learned.
**Acceptance:** 36 unit tests in `lib/blockers/pathway-preference.test.ts`; demo Step 5 — after accumulated `decision`-kind choices favoring `extend_work_trade`, a new same-kind blocker whose input order leads with `charge_overstay_fee` is persisted leading with `extend_work_trade`.

### D6 — Metrics framework for "community intelligence"
**As built:** `lib/metrics/community-intelligence.ts` computes **five** report-grade KPIs from live world-model + audit data, each `null` on a zero denominator (honest "no data," never a fake 0). **Four** are surfaced as governed `intelligence_metric` catalog widgets on the steward board (see §6, §7).
**Acceptance:** 46 unit tests in `lib/metrics/community-intelligence.test.ts` + 6 in `lib/widgets/intelligence-metric.test.ts`; deterministic non-null KPIs asserted by `scripts/seed-decision-lifecycle.ts` (§6).

**Overall: 6 / 6 met.** Build is green (`tsc --noEmit` exits 0 in-container); the demo prints `=== M3 DEMO NARRATIVE PASS ===`.

---

## 5. Community-intelligence KPI framework

All five KPIs live in `lib/metrics/community-intelligence.ts` as **pure, deterministic functions**: they accept already-fetched rows, perform no I/O, make no DB calls, import no ontology. Ratios return a number in `[0, 1]` **or `null` when the denominator is zero** — never `NaN`, never a fake 0. This null-on-no-data discipline is the honesty contract: an empty community reports "—", not "100%".

| # | KPI | Definition (exact) | Null when |
|---|---|---|---|
| 1 | **autonomyRatio** | `auto_applied / (auto_applied + escalated)` over `result:"ok"`, `subject_type:"action"` audit rows. `escalated` = rows whose `subject_id` is an escalation action (`DEFAULT_ESCALATION_ACTIONS = ["flag_blocker"]`); `auto_applied` = rows whose `policyOf(subject_id) === "auto_apply"` and which are *not* escalation actions. `always_confirm` (human-initiated) and unknown-policy non-escalation rows are **excluded** from the denominator, so the ratio is not inflated. | no agent-initiated decisions |
| 2 | **scenarioAcceptanceRate** | `resolved / closed`, where closed = status ∈ {`resolved`, `dismissed`, `expired`} and numerator = status `resolved`. | no closed blockers |
| 3 | **decisionLatencyMsMedian** | median of `parse(resolved_at) − parse(created_at)` (ms) over `resolved` blockers with both timestamps parseable and `resolved_at ≥ created_at` (negative durations excluded as data errors). A duration, not a ratio — may exceed 1. | no eligible resolved blockers |
| 4 | **coordinationCoverage** | `addressed / detected` = (blockers with status ≠ `open`) / (all blockers). | no blockers |
| 5 | **resolutionAccuracy** | `held / (held + reflagged)` over resolved blockers with a parseable `resolved_at`. A blocker is *re-flagged* if any other blocker sharing the same `(blocked_actor_id, reason_kind, summary)` triple was created strictly **after** this one's `resolved_at`. Numerator = not re-flagged. | no eligible resolved blockers |

`computeCommunityIntelligence(blockers, audits, policyOf)` returns all five in one call.

---

## 6. Deterministic values & which four KPIs are surfaced

### Deterministic values (the evidence seed)

`scripts/seed-decision-lifecycle.ts` is self-asserting and idempotent; it populates a realistic decision lifecycle (10 resolved blockers across ≥3 `reason_kind`s, a re-flagged pair, 10 `log_incident`/4 `check_in` "ok" audit rows plus excluded error/replay rows) so the KPIs compute **non-null** on live data. The deterministic values it produces:

| KPI | Value | Reads as |
|---|---|---|
| autonomyRatio | **0.7333** | 73% |
| scenarioAcceptanceRate | **1.0** | 100% |
| decisionLatencyMsMedian | **2,400,000 ms** | 40 min |
| coordinationCoverage | **0.9474** | 95% |
| resolutionAccuracy | **0.9444** | 94% |

*(The seed self-asserts each value — the script fails if any drifts — so these are reproducible ground truth, not a one-off snapshot. The DELIVERY_REPORT §6 cites the same figures.)*

### Which four are surfaced, and why latency is computed-but-not-surfaced

The board surfaces **exactly four** KPIs as `intelligence_metric` widgets:

```
["autonomy", "acceptance", "coverage", "accuracy"]
```

This is the source of truth in `lib/widgets/derive-board.ts` (line ~80), inside the admin block gated on `agent_blocker` read permission. **Latency is computed but deliberately not surfaced.** The four surfaced KPIs are all governance-quality *ratios* in `[0,1]` that render cleanly as a single percentage and that a steward reads as "is the autonomy working and is it trustworthy." Latency is a *duration* with different units (minutes), a different mental model (operational responsiveness, not decision quality), and a noisier signal on a small community — so it stays available in the engine and the catalog (the `latency` KPI exists in `INTELLIGENCE_KPIS` and `kpiToMetricData` renders it as "N min") but is not auto-placed on the steward board. The vocabulary is complete; the default composition is curated.

> **Surfaced set (authoritative):** the board surfaces **autonomy, acceptance, coverage, accuracy**; **latency is the one omitted**. Both this spec and the DELIVERY_REPORT §6 reflect the as-built code (`derive-board.ts` line ~80).

---

## 7. The `intelligence_metric` widget — catalog → read-api (fence) → ResolvedWidgetCard

A KPI reaches the steward through one governed path, end to end, with no new rendering surface and no new write path.

**Catalog (`lib/widgets/catalog.ts`).** `intelligence_metric` is the fifth catalog kind (`CATALOG_KINDS`). Unlike the other kinds it carries **no ontology `type`** — its config is just `{ kpi }` where `kpi ∈ INTELLIGENCE_KPIS = [autonomy, acceptance, coverage, accuracy, latency]`. Its `queryBinding` calls `api.communityIntelligence()` and maps the result with the pure `kpiToMetricData(kpi, m)`:
- ratios render as `${Math.round(r*100)}%`; latency as `${Math.round(ms/60000)} min`;
- a **null KPI renders `"—"`** (never a fake 0).

**Read-api fence (`lib/widgets/read-api.ts#communityIntelligence`).** This is where the widget rides the same gate as the veto-queue:
- it `resolveType("agent_blocker")` and checks `canReadType` — **fail-closed**: a viewer not permitted to read `agent_blocker` gets **all-null KPIs** (the same "no data" value the pure metrics return), *before any SQL*. So org-intelligence aggregates surface only to roles allowed the blocker queue (the steward), **never to a member**.
- it then reads all `agent_blocker` rows (typed drizzle select) + `action_audit` rows via the proven `PgAuditReader` (the same source the veto-queue autonomy split uses), with `policyOf` resolved live from the loaded ontology (`ontology.action_types[name]?.agent_policy` — never a stale map), and calls `computeCommunityIntelligence`.

**Board surfacing (`lib/widgets/derive-board.ts`).** The four widgets are pushed onto the board **inside the same admin block, gated on the same `canReadType("agent_blocker")`** as the "Awaiting your decision" veto-queue table. They ride the identical read gate — the steward sees the queue *and* the KPIs about that queue; a member sees neither.

**Renderer (`components/dashboard/ResolvedWidgetCard.tsx`).** `intelligence_metric` dispatches to the **same `MetricWidget`** as the generic `metric` kind (same `MetricData` shape). Because its config carries no ontology `type`, `MetricWidget` renders `data.label` (e.g. "Agent autonomy") + `data.display` (e.g. "73%") and the card title is a plain label (not a `/[type]` link). One render path, two callers — no bespoke component.

---

## 8. Self-correction loop — safest-reversibility-first, then accumulated preference

The self-correction logic is pure (no DB, no I/O) in `lib/blockers/pathway-preference.ts`, so it is safe to import anywhere — tests, server, client. It has two parts.

**(1) Tally what the community chose.** `computePathwayPreference(rows, reasonKind)` walks resolved blockers of the given `reason_kind`, finds the chosen pathway by `resolved_via_pathway_id`, and tallies by **semantic identity** (`pathwayIdentity`: prefer `action.type` — *what* the agent will do — over the human-readable label, which may vary). Returns `identity → count`. Rows whose `resolved_via_pathway_id` matches no parsed pathway are silently ignored (data-integrity gap, not an error). `parsePathways` defends against the jsonb-as-string-or-array ambiguity and rejects malformed entries.

**(2) Re-rank the next proposal.** `rankPathways(pathways, preference)` returns a **new** array (input never mutated), sorted by these keys in order:

1. **reversibility tier ASC** — `easy(0) < moderate(1) < permanent(2)`; unknown/missing → `moderate(1)` (a neutral middle). **This is the hard safety floor: accumulated popularity can NEVER surface a less-reversible action above a more-reversible one.** Self-correction must not erode safe-by-default ordering.
2. **preference count DESC** — within a safety tier, the historically-preferred identity leads (absent from the map = 0).
3. **original index ASC** — stable tie-break, preserves the agent's order for full ties.

This is wired into `flag_blocker`, so the persisted pathway order of every *new* escalation already reflects what the community has learned — but only within the safety envelope. The demo's priming blockers deliberately make all pathways `moderate` so that *preference*, not the safety tier, decides the lead — isolating the learning signal for the assertion.

---

## 9. Demo narrative — the five steps `demo-m3-narrative.ts` asserts

`scripts/demo-m3-narrative.ts` runs the full loop against the **real pipeline + real Postgres**, asserting each step and printing a readable transcript. It is idempotent (cleanup runs first, tag-scoped), deterministic (fixed UUIDs + ISO timestamps), and non-destructive (only touches rows it created). The steward actor drives; no permission boundary is weakened.

1. **OBSERVE + AUTO-APPLY.** The real `resolveActionPolicy("log_incident")` must return `auto_apply` (no confirmation gate). An `IncidentLog` row is committed through the **real permission-checked** `ctx.objects.IncidentLog.create` and a real `PgAuditStore` "ok" `action_audit` row is written. *Proves the autonomy leg of the governance gate.*
2. **ESCALATE.** The agent hits a judgment call (guest overstay on bed D3-A2) and `flag_blocker` raises an `AgentBlocker` with **exactly 3 pathways**, landing **OPEN** in the veto-queue. Asserted: `status === "open"`, `parsePathways(...).length === 3`.
3. **HUMAN PICKS.** The steward disposes on the community's behalf. First the agent leg (no bypass) is asserted to **gate** with `confirmation_required:always_confirm`; then the human-Confirm leg (`bypassConfirmation:true`, exactly what `app/api/chat/confirm/route.ts` sets) succeeds, flipping `status → resolved` and setting `resolved_via_pathway_id`. *The surface-then-decide collective-decision contract — no fabricated vote.*
4. **METRICS MOVE.** `computeCommunityIntelligence` is run over the **live** rows before and after Step 3. Asserted: `coordinationCoverage` **rises** (an open blocker became closed), and `scenarioAcceptanceRate` is **non-decreasing** (a resolution can't lower acceptance).
5. **NEXT PROPOSAL TUNED.** Two more `decision`-kind blockers are resolved toward `extend_work_trade` (giving ≥3 such resolutions), then a **new** blocker is flagged whose input order leads with `charge_overstay_fee`. Because `flag_blocker` calls `rankPathways → computePathwayPreference`, the **persisted** order is asserted to **lead with `extend_work_trade`** — and the test guards that the preferred identity was *not* first in the input. *The loop learned.*

Final line: `=== M3 DEMO NARRATIVE PASS ===`.

---

## 10. Verification standard & known constraints

### Verification standard

- **Deterministic integration / live-DB proofs over browser clicks.** Because the chat input is a flaky React-controlled component, agent → tool → apply paths are verified by deterministic, self-asserting scripts against live Postgres (`demo-m3-narrative.ts`, `seed-decision-lifecycle.ts`, `seed-scale-community.ts`) rather than the browser. Established across the build.
- **Pure-core unit tests (the M3 surface is green).** The decision-quality logic is pure and unit-tested: `lib/metrics/community-intelligence.test.ts` (**46 tests**), `lib/blockers/pathway-preference.test.ts` (**36 tests**), `lib/widgets/intelligence-metric.test.ts` (**6 tests**). The full M3 surface — `lib/metrics` + `lib/blockers` + `lib/widgets` (including read-api, derive-board, and the resolve-path regression test) — passes **211 tests** clean.
- **Broader-suite drift (pre-existing) — REMEDIATED.** The *wider* platform suite previously carried ~60 pre-existing failures from ontology evolution (removed actions `add_member`/`delete_member`/`record_attendance`, permission/role changes, codegen-snapshot retargets, a deliberately-removed `attended`/`authored` link runtime surface) where older tests were never updated against the evolved ontology. These were **stale tests, not code defects**: 30 files were updated to current correct behavior or deleted where they tested removed features (clean-break); two permission tests were *strengthened* to fail-closed. The full package suite now passes (**1275 tests**); `tsc --noEmit` clean. (`lib/setup/scenario-*` fail only in a working tree carrying the untracked local `scenarios/clean-base/` dev-scaffold; a clean checkout has the six tracked scenarios and passes.)
- **Green build.** `tsc --noEmit` exits 0.
- **Idempotent evidence.** Every seed/demo cleans up by tag first and asserts a PASS, so re-running reproduces identical results and never pollutes real data.

### Known constraints (honest)

1. **`log_incident` declarative path — RESOLVED.** Previously threw NOT-NULL on `incident_log.reported_by`: a `ref → Member` property that `log_incident` does not collect and the declarative runner cannot auto-fill, so the create-leg violated NOT NULL on the live DB (the in-memory test store, which enforces no constraints, hid it; the demo Step 1 used a handler-direct fallback). **Fix:** `reported_by` is now `required: false` in the ontology, so codegen emits a nullable column — also the correct semantics (an agent-logged incident has no required human reporter). The full declarative `runApplyActionTool` create-leg now commits with `reported_by` NULL. Pinned by `lib/actions/log-incident-reported-by-optional.test.ts` and verified against live Postgres.
2. **Steward-home (`/`) KPI widgets — RESOLVED (was a real defect).** This was previously logged as "render not screenshot-confirmed; likely a dev-server/cache artifact." Live verification disproved that: the board resolver (`runDescriptors` in `lib/widgets/per-user.ts`) gated descriptor kinds against a hand-listed local whitelist that omitted `intelligence_metric`, so the KPI descriptors `deriveDefaultBoard` produced were silently dropped before resolution — the descriptor-generation tests passed while the live board showed no KPIs. Fixed by deriving the gate from the catalog's canonical `CATALOG_KINDS`; verified through the live page resolve path against the live DB (all four KPIs resolve: autonomy 73% / acceptance 100% / coverage 95% / accuracy 94%) and pinned by `lib/widgets/resolve-intelligence-metric.test.ts`. (See the terminology note below — post-UI-rework the board is the steward home `/`.)

### Post-UI-rework reality (terminology)

The DELIVERY_REPORT and earlier drafts refer to a separate **"/org" steward dashboard**. After the UI rework (`feat/acropolisos-ui-rework`), there are **no fixed nav tabs** and the old `/org` was **folded into `/`** — the steward's **home (`/`) IS the composed admin board** (`deriveDefaultBoard(..., { admin: true })`). The four `intelligence_metric` widgets and the veto-queue render there, gated on `agent_blocker` read. Any reference to "the steward /org dashboard" should be read as "the steward home board." The render path is identical (`ResolvedWidgetCard`, imported by both `app/page.tsx` and `app/org/page.tsx` — one path, two callers).
