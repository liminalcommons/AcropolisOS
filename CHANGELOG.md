# Changelog

All notable changes to acropolisOS are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.0] - 2026-05-17 — v5 (TypeScript reimagining)

This is the **fifth iteration** of the acropolisOS concept — a self-hostable,
AI-first ontology platform for small communities (50–200 people). Each prior
attempt explored a different stack and shape. v5 is a ground-up TypeScript
reimagining built on Next.js 16 + Postgres + Drizzle + Refine + Mastra + Inngest.

### Lineage

| Version | Focus | Stack |
|---------|-------|-------|
| v1–v2   | Community AI / funding discovery | Python · Cognee · GrantChat · Sentinel |
| v3–v4   | Iterations (not released here)   | varied |
| **v5**  | AI-first ontology platform        | **Next.js 16 · TS · Postgres · Drizzle · Refine · Mastra · Inngest** |

The earlier versions live in their own repositories. v5 is intentionally a
clean slate — different stack, different shape, different mental model.

### What v5 is

- **YAML ontology as the source of truth.** Object types, link types, action
  types, and views are declared in YAML; Drizzle schemas, Zod validators, Refine
  CRUD routes, and Mastra agent tools are generated from them.
- **Chat as the primary surface.** A persistent chat panel hosts an LLM agent
  whose tools are PROPOSE / READ / APPLY against the ontology. Mutations land as
  reviewable proposals, not direct writes.
- **Three-layer permission enforcement.** `ctx` accessor (DB read/write gate),
  Inngest middleware (action gate), and Mastra tool gating (agent gate). Plus
  an ESLint sandbox restricting what `functions/**/*.ts` can import.
- **Single-host install.** `docker compose up` brings up Postgres + the Next.js
  app + a self-hosted Inngest dev server, ready at `http://localhost:3030/setup`.

### Build process

v5 was built in a 2-day burst (2026-05-15 → 2026-05-17) using Ralph TUI
in autonomous headless mode, with Claude Opus 4.7 at high effort. The build
ran against a 37-user-story epic (`castalia-c5s.1..37`) derived from the
locked design spec at `docs/superpowers/specs/2026-05-15-acropolisos-design.md`.

37 / 37 stories closed. 547+ tests passing. Full quality gates (`npm run
typecheck && npm run lint && npm test`) green at epic close.

### Added

- **Foundation (US-001..010)**: Next.js 16 + TypeScript strict + Tailwind v4 +
  shadcn scaffold; Drizzle + Postgres wiring; ontology artifact schema +
  loader; seed ontologies + integrity assertion; YAML → Drizzle codegen; YAML
  → Zod codegen; typed `ctx` accessor; audit tables + writers; drop-ingest
  endpoint + inbox table; first-run `/setup` wizard.
- **Chat + propose (US-011..022)**: NextAuth v5 with role/ctx middleware;
  Mastra agent + BYOK provider + `/api/chat`; Mastra tools codegen; READ tools
  (describe/query/traverse/sample/read/audit); PROPOSE tools + draft store;
  PROPOSE tools for action/function/view/seed/ingest; persistent chat panel
  UI; inline proposal panel; `/proposals` steward review queue; transactional
  proposal apply pipeline; Refine codegen (auto-CRUD routes per object type);
  dev hot-reload pipeline (artifact → codegen → live).
- **Actions (US-023..030)**: Inngest substrate + dev wiring; declarative
  `action_type` runner; function-backed action runner; per-action policy
  gating; `apply_action` dispatcher; side-effect channels
  (notify_member/notify_steward/webhook); action composition (`ctx.actions.X`);
  `action_audit` middleware.
- **Permissions + distribution (US-031..037)**: Permission enforcement in
  `ctx`; action-layer permission middleware; Mastra tool gating; data-audit
  Postgres triggers; `create-acropolisos` CLI installer; docker-compose
  single-host install; backup/restore CLI.

### Quality gates at release

- `npm run typecheck` — passing
- `npm run lint` — passing
- `npm test` — 547+ tests passing
- Manual smoke: setup wizard → chat → propose → apply pipeline verified

### Known limitations

- LLM provider is BYOK only — no managed key flow.
- Apache AGE graph traversal is wired but only engaged for explicit
  `ctx.graph.*` calls; most reads use plain Postgres.
- No multi-tenant story — each install is one community.
- Backup/restore CLI dumps the whole database; selective object-type export
  is not yet implemented.

## [Unreleased]

_Nothing yet._
