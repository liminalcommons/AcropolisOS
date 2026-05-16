# acropolisOS

Self-hostable AI-first ontology platform for small communities (50–200 people).

**Design spec:** [`docs/superpowers/specs/2026-05-15-acropolisos-design.md`](../../docs/superpowers/specs/2026-05-15-acropolisos-design.md) (commit `fcfe553b4`)
**PRD:** [`tasks/prd-acropolisos.md`](../../tasks/prd-acropolisos.md)

## Stack

- Next.js 16 App Router · TypeScript strict · Tailwind v4
- Postgres + Apache AGE (extension, engaged only when graph traversal is needed)
- Drizzle ORM (schemas emitted from YAML ontology)
- Refine (MIT, headless) + shadcn for auto-CRUD UI
- Mastra over Vercel AI SDK for the agent runtime (Zod-typed tools, BYOK LLM)
- Inngest for action execution (typed events, middleware, idempotency, audit)
- NextAuth v5

## Quickstart

```bash
npm install
npm run dev   # http://localhost:3030
```

## Quality gates

```bash
npm run typecheck
npm run lint
npm test
```
