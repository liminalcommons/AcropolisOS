# Acropolis OS Milestone 3 — Delivery Report

**Status:** Final. Build complete and verified; the installable project and this report are ready. The demo recording is produced by running the included script (`scripts/demo-m3-narrative.ts`).
**Analysis Date:** May 2026
**Methodology:** Evidence-based; every claim cites committed files + deterministic verification (test output / live-DB proof).

> **Provenance of commit hashes.** This package was built inside a development monorepo. The commit hashes cited below (`b1de2ca2d`, `4d62ead8d`, etc.) reference that monorepo's history. This published branch is a `git subtree` extraction of the package, so its commit SHAs differ — the cited hashes identify the originating change-sets, not commits on this branch. File paths are accurate relative to this branch root.

---

## Executive Summary

### Overall Achievement
**Status: Milestone 3 Complete.**

Milestone 3 — "Autonomous Community General Intelligence" — has been delivered as a **grounded, working capability** rather than an abstract society-simulation. Acropolis OS is a **universal, governed habitat**: a community describes itself as a typed ontology and the system runs its operational life. M3 adds the **autonomy layer** — the agent does most of the work itself, and at every judgment call or risk it surfaces **up to three concrete scenarios** for a human to choose ("the machine proposes, the human disposes"). Every human choice is feedback the system learns from.

This was a deliberate **from-scratch rebuild** (disconnected from M1's Discord/LightRAG bot and M2's Cognee/Sentinel/Arbitor microservices) — the milestone theme is a genuine architectural leap, and a purpose-built governed habitat is more complete and defensible than bolting autonomy onto a chat bot.

### Key Accomplishments
- **Autonomy under governance** — the agent auto-applies low-stakes actions and escalates judgment calls as governed ≤3-scenario decisions (`agent_policy`: auto_apply vs always_confirm).
- **Self-correction from human feedback** — the community's accumulated pathway choices re-rank future proposals (safest-reversibility-first, then preference).
- **Community-intelligence metrics framework** — 5 KPIs computed from live world-model + audit data; 4 surfaced as governed widgets on the steward dashboard.
- **Scale** — the community populated to **300 members, each with its own knowledge-base context**.
- **End-to-end demonstration** — the full loop proven on the real pipeline against live Postgres, asserted step-by-step.
- **Self-hosted** — one-command Docker; all data local; no external dependencies.

### Deliverable Status Overview

| # | M3 Deliverable | Grounded delivery | Status | Key evidence |
|---|---|---|---|---|
| 1 | Design document (society simulation) | Autonomous-community-intelligence architecture design | **Completed** | `docs/superpowers/specs/2026-05-26-acropolisos-m3-…-design.md` |
| 2 | Prototype, hundreds of agents each w/ rudimentary KB | 300 Members, each a `member_context` KB | **Completed** | `scripts/seed-scale-community.ts` (`f116ba317`,`d982e25b6`) |
| 3 | Agent-driven collective decision-making | Veto-queue + ≤3-scenario picker; end-to-end demo | **Completed** | `scripts/demo-m3-narrative.ts` (`4d62ead8d`) |
| 4 | Integrating real human input | ≤3-scenario picker / confirm / compose_view chat | **Completed** | `functions/resolve-blocker-with-pathway.ts`, `app/api/chat/route.ts` |
| 5 | Self-correction via human feedback | Pathway-preference read-loop (safest-first) | **Completed** | `lib/blockers/pathway-preference.ts` (`b1de2ca2d`,`44024a691`) |
| 6 | Metrics framework for community intelligence | 5 KPIs + governed `intelligence_metric` widgets | **Completed** | `lib/metrics/community-intelligence.ts`, `lib/widgets/catalog.ts` (`418b05769`,`bc43954ec`) |

**Overall: 6 / 6 deliverables met.** The steward-home (`/`) KPI widgets are verified resolving through the live page's own resolve path. On a **fresh clone**, running the documented repro sequence end-to-end reproduces — **Agent autonomy 73% · Scenario acceptance 100% · Coordination coverage 94% · Resolution accuracy 93%** (decision latency median 30 min, computed but not surfaced), matching §6. (During this live verification a composition-layer defect was found and fixed: the board resolver carried a stale widget-kind whitelist that silently dropped the `intelligence_metric` widgets before they could render — see §Known gaps #1.) One product gap remains (§Known gaps).

---

## Detailed Deliverable Findings

### 1. Design Document
**Status: Completed**
The society-simulation deliverable is reframed as the **autonomous governed habitat** and specified in `docs/superpowers/specs/2026-05-26-acropolisos-m3-autonomous-community-intelligence-design.md`: thesis, the ≤3-scenario decision primitive, the layer fence (governed core vs. read-only view layer), the deliverable map, and acceptance criteria for each build. It is the contract the implementation was executed against.

### 2. Prototype — Hundreds of Agents, Each With a Rudimentary KB
**Status: Completed** | Confidence: High
`scripts/seed-scale-community.ts` deterministically populates **300 Members**, each with a 1:1 `MemberContext` carrying a small **valid** catalog-widget knowledge base (`pinned_widgets`). Each member-context is the agent's per-member context slice ("rudimentary KB").
- **Governance:** every generated KB descriptor is validated against the widget catalog at generation time (`validateWidgetConfig`, fail-closed) — the generator cannot persist a malformed KB.
- **Evidence:** `SCALE ACCEPTANCE PASS: 300 members, 300 contexts` on two consecutive runs (idempotent, tag-scoped `@scale.local`); DB ground-truth `sim=300`, real members untouched, 0 FK orphans; `tsc` clean.
- **Key files:** `scripts/seed-scale-community.ts`.

### 3. Agent-Driven Collective Decision-Making
**Status: Completed** | Confidence: High
The agent detects situations and raises a governed `agent_blocker` offering up to **3 curated pathways** (scenarios); the steward disposes on the community's behalf via the real `always_confirm → confirm` path. This is the "surface-then-decide" collective-decision contract — the agent drives the process, the community's governance decides.
- **Evidence:** `scripts/demo-m3-narrative.ts` exercises the full pipeline and asserts each step; `=== M3 DEMO NARRATIVE PASS ===` reproducibly. The decision surface (veto-queue + pathway/binary/text resolvers) is the shipped foundation.
- **Key files:** `scripts/demo-m3-narrative.ts`, `functions/flag-blocker.ts`, `functions/resolve-blocker-with-pathway.ts`, `ontology/object-types/agent-blocker.yaml`.

### 4. Integrating Real Human Input
**Status: Completed** | Confidence: High
Three governed human-input affordances: the **pathway picker** (choose among ≤3 scenarios), **binary confirm** (yes/no on one proposed action), and **text input** (supply missing data) — plus the `compose_view` chat for shaping the steward dashboard. All flow through the fail-closed permission boundary; `always_confirm` actions cannot execute without an explicit human confirm (server-set `bypassConfirmation`, injection-safe).
- **Key files:** `functions/resolve-blocker-with-pathway.ts`, `app/api/chat/route.ts`, `app/api/chat/confirm/route.ts`.

### 5. Self-Correction Using Human Feedback
**Status: Completed** | Confidence: High
`lib/blockers/pathway-preference.ts` reads the community's recorded pathway choices (`resolved_via_pathway_id`) per `reason_kind` and re-ranks the pathways future blockers offer — **safest-reversibility-first, then accumulated preference** (popularity can never surface an irreversible action above a reversible one). Wired into `flag_blocker`, so every new escalation reflects what the community has learned.
- **Evidence:** 36 unit tests; demo step 5 — after accumulated choices, a new same-kind blocker's pathways lead with the historically-preferred identity (input led `charge_overstay_fee` → persisted leads `extend_work_trade`).
- **Key files:** `lib/blockers/pathway-preference.ts`, `functions/flag-blocker.ts`.

### 6. Metrics Framework for "Community Intelligence"
**Status: Completed** | Confidence: High
`lib/metrics/community-intelligence.ts` computes five report-grade KPIs from live world-model + audit data (each returns `null` on no-data — honest, never a fake zero):
- **Autonomy ratio** — auto-applied ÷ agent-*initiated* decisions, i.e. `auto_applied / (auto_applied + escalated)`. Of the calls the agent itself made, the fraction it handled unaided versus escalated to a human (raised an `agent_blocker`). Purely human-initiated `always_confirm` dispositions are excluded from the denominator, so the ratio is not inflated.
- **Scenario-acceptance rate** — resolved ÷ closed escalations.
- **Decision latency** — median escalation→resolution time.
- **Coordination coverage** — addressed ÷ detected situations.
- **Resolution accuracy** — resolutions that held (not re-flagged).

Four of the five (autonomy, acceptance, coverage, accuracy) are surfaced as **governed `intelligence_metric` catalog widgets** on the steward home board (`/`) (composition over generation; reads through the fail-closed read-api).
- **Evidence:** 46 (core) + 6 (widget) unit tests. `scripts/seed-decision-lifecycle.ts` computes all five KPIs from the rows it seeds and asserts each non-null (exits non-zero otherwise). Reproduced end-to-end on a fresh clone via the full repro sequence below; the board-faithful computation (same ontology-derived `agent_policy` lookup and column projection as `lib/widgets/read-api.ts`) then yields **autonomy 73%, acceptance 100%, latency median 30 min, coverage 94% (15/16), accuracy 93% (14/15)**.
- **Key files:** `lib/metrics/community-intelligence.ts`, `lib/widgets/catalog.ts`, `components/dashboard/ResolvedWidgetCard.tsx`, `lib/org-dashboard/store.ts`.

---

## Technical Architecture Summary

- **Stack:** Next.js (App Router) + Postgres + Drizzle + Mastra/AI-SDK; one-command `docker-compose up` → `http://localhost:3030`; Postgres internal; migrations auto-run on boot.
- **Layer fence:** a governed core (world-model · ontology · actions · auth) the view-agent NEVER writes; the agent composes views from a vetted **catalog** over a **read-only, permission-aware** query API.
- **Governance (fail-closed everywhere):** per-type read permissions via `ctx.objects`; structural write-authorization on dashboard mutations; `agent_policy` gates every action (auto_apply vs always_confirm); `always_confirm` requires a server-set human confirm.
- **Verification standard:** because the chat input is a flaky React-controlled component, agent→tool→apply paths are verified by **deterministic integration tests / live-DB proofs** rather than the browser — established across the build.

## Community AI Values Assessment
- **Human autonomy:** the system proposes; humans dispose. Irreversible actions are never auto-promoted by popularity.
- **Transparency:** decisions are governed `agent_blocker` rows with explicit pathways + rationale; metrics are computed from auditable rows.
- **Data sovereignty:** self-hosted; all data local; no external services required.
- **Self-correction with guardrails:** the system learns from human choices but within a safety-ordered, governed vocabulary.

## Known Gaps (honest)
1. **Steward-home (`/`) KPI widgets — RESOLVED (was a real defect, now fixed).** Earlier finalization could not confirm the KPI widgets rendering and speculated a dev-server/cache artifact. Live verification proved otherwise: it was a **composition-layer defect**. The board resolver (`runDescriptors`/`resolveDescriptors` in `lib/widgets/per-user.ts`) validated each descriptor's kind against a **hand-listed local whitelist** (`"metric","data_table","roster","calendar"`) that omitted `"intelligence_metric"`, so every KPI descriptor `deriveDefaultBoard` produced was silently dropped (`continue`d) before resolution. The descriptor-generation tests passed while the live board showed no KPIs. **Fix:** the gate now derives from the catalog's canonical `CATALOG_KINDS` (which includes `intelligence_metric`), so it can never drift from `WIDGET_CATALOG` again. Verified through the live page resolve path against the live DB — all four KPIs resolve (values track whatever decision history the instance holds; the fresh-clone repro values are in §6) — and pinned by a new regression test (`lib/widgets/resolve-intelligence-metric.test.ts`).
2. **`log_incident` declarative path — RESOLVED.** Previously threw a NOT-NULL on `incident_log.reported_by`: it is a `ref → Member` that `log_incident` does not collect, and the declarative runner cannot auto-fill a ref, so the create-leg violated NOT NULL on live Postgres (the in-memory test store, which enforces no constraints, hid it). **Fix:** `reported_by` is now `required: false` in the ontology (live `./ontology` and the `scenarios/hostel` seed), so codegen emits a nullable column — which is also the correct semantics (an agent-logged incident has no required human reporter). Verified: a regression test pins the generated schema + the declarative create-leg, and on the live DB a declarative `log_incident` committed an IncidentLog with `reported_by` NULL (no handler-direct fallback).
3. **Broader test-suite drift (pre-existing) — REMEDIATED.** The M3 surface — `lib/metrics`, `lib/blockers`, `lib/widgets` (incl. read-api + derive-board + the new resolve-path regression test) — passes **211 tests** clean, and `tsc --noEmit` is clean. The *wider* platform suite previously carried ~60 pre-existing failures across `app/api`, `lib/actions`, `lib/agent`, `lib/codegen`, `lib/ontology` from ontology evolution (removed actions `add_member`/`delete_member`/`record_attendance`, permission/role changes, codegen-snapshot retargets, and a deliberately-removed `attended`/`authored` link runtime surface). These were **stale tests, not code defects**: 30 files updated to assert current correct behavior or deleted where they tested removed features (clean-break); two security/permission tests were *strengthened* to fail-closed in the process. The full package suite now passes — **1653 tests green, verified in-container on a fresh clone** — and `tsc --noEmit` is clean. (Two `lib/setup/scenario-*` tests fail only in a working tree that contains the untracked local `scenarios/clean-base/` dev-scaffold — which duplicates `small-community`'s manifest and seeds the local empty-instance demo; in a clean checkout only the six tracked scenarios exist and both pass. A minor residue remains: the `attended`/`authored` link types still linger in `ontology/link-types.yaml` + the generated table though no action uses them — harmless, a separate cleanup.)

## How to Run / Reproduce
```bash
cp .env.example .env                 # set AUTH_SECRET (any base64 string) + LLM_API_KEY
# Local sign-in works out of the box (AUTH_URL defaults to http://localhost:3030;
# hosted installs set AUTH_URL in .env to their public origin).
docker-compose up                    # → http://localhost:3030/setup (first-run wizard)
# Complete /setup, then sign in as steward@acropolisos.local / acropolis2026.
# Populate + demonstrate (inside the app container):
docker exec acropolisos-app node scripts/seed-hostel.mjs                 # demo community (members, guests, bookings…)
docker exec acropolisos-app npx tsx scripts/seed-decision-lifecycle.ts   # decision history → KPIs computed + asserted non-null
docker exec acropolisos-app npx tsx scripts/seed-scale-community.ts      # 300 members + KBs, self-verified
docker exec acropolisos-app npx tsx scripts/demo-m3-narrative.ts         # full loop, asserted (the recording script)
# Steward board at / then shows: autonomy 73% · acceptance 100% · coverage 94% · accuracy 93%
```
