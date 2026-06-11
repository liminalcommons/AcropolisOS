# acropolisOS v5

Self-hostable AI-first ontology platform for small communities (50–200 people).

> **v5** is the fifth iteration of the acropolisOS concept — a ground-up
> TypeScript reimagining. See [`CHANGELOG.md`](CHANGELOG.md) for the lineage
> from earlier Python-based iterations (v1–v4).

**Design specs:** [`docs/superpowers/specs/`](docs/superpowers/specs/) — start with
[`2026-05-26-acropolisos-m3-autonomous-community-intelligence-design.md`](docs/superpowers/specs/2026-05-26-acropolisos-m3-autonomous-community-intelligence-design.md)
**Delivery report:** [`DELIVERY_REPORT.md`](DELIVERY_REPORT.md)

## Stack

- Next.js 16 App Router · TypeScript strict · Tailwind v4
- Postgres + Apache AGE (extension, engaged only when graph traversal is needed)
- Drizzle ORM (schemas emitted from YAML ontology)
- Refine (MIT, headless) + shadcn for auto-CRUD UI
- Mastra over Vercel AI SDK for the agent runtime (Zod-typed tools, BYOK LLM)
- Inngest for action execution (typed events, middleware, idempotency, audit)
- NextAuth v5

## Quickstart

### Local development

```bash
npm install
npm run dev   # http://localhost:3030
```

### Single-host install via Docker

Postgres, the Next.js app (with migrations applied on first boot), and a
self-hosted Inngest dev server come up together with one command.

```bash
cp .env.example .env   # fill in AUTH_SECRET and LLM_API_KEY at minimum
docker compose up      # → http://localhost:3030/setup within ~60s
```

The compose stack bind-mounts `./ontology`, `./functions`, `./uploads`, and
`./.env` from the host so the steward can edit them without rebuilding the
image. Postgres data persists in the `pgdata` named volume; the steward's
setup marker lives in `appdata` at `/app/data`.

Local sign-in works out of the box (`AUTH_URL` defaults to
`http://localhost:3030`); hosted installs set `AUTH_URL` in `.env` to their
public origin.

## Milestone 3 repro (Autonomous Community Intelligence)

Full demo from a fresh clone — seeds a hostel community, a governed decision
lifecycle, a 300-member scale community, then runs the end-to-end narrative:

```bash
cp .env.example .env                 # set AUTH_SECRET (any base64 string) + LLM_API_KEY
docker compose up                    # → http://localhost:3030/setup (first-run wizard)
# Complete /setup, then sign in as steward@acropolisos.local / acropolis2026.
docker exec acropolisos-app node scripts/seed-hostel.mjs
docker exec acropolisos-app npx tsx scripts/seed-decision-lifecycle.ts
docker exec acropolisos-app npx tsx scripts/seed-scale-community.ts
docker exec acropolisos-app npx tsx scripts/demo-m3-narrative.ts
```

The steward board at `/` then shows the community-intelligence KPIs:
**autonomy 73% · acceptance 100% · coverage 94% · accuracy 93%**
(decision latency median 30 min). These values are deterministic for the
seeded history and verified on independent fresh installs — full evidence in
[`DELIVERY_REPORT.md`](DELIVERY_REPORT.md).

Tests run in-container too (1653 green on a fresh clone):

```bash
docker exec acropolisos-app npx vitest run
```

## Quality gates

```bash
npm run typecheck
npm run lint
npm test
```

## Codegen safety

`lib/**/*.generated.ts` are emitted from YAML. There are two regeneration paths — do not confuse them:

- **Boot / live:** `scripts/regenerate-from-live.ts` reads the bind-mounted `./ontology/` (the single source of truth at runtime). The docker entrypoint runs this before `drizzle-kit push`.
- **Seeding a scenario (dev only):** `npm run codegen -- <bundle>` regenerates from `scenarios/<bundle>/ontology/`.

> **Warning:** `npm run codegen` with no argument is **refused** — a bare run would regenerate from the `small-community` seed and **clobber** the richer live ontology. Always pass an explicit bundle name, e.g. `npm run codegen -- hostel`.
