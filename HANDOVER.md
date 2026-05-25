# acropolisOS — Rebuild Handover (2026-05-25)

You are picking up a **completed overnight rebuild**. This doc gets you oriented cold and tells you exactly how to verify, what exists, the traps, and what to do next.

---

## TL;DR

acropolisOS was rebuilt from a faked concept into a **functioning, governed, per-user habitat** over 16 opponent-loop cycles. The whole assimilation pipeline + per-user widget dashboard works end-to-end and is proven. The loop is stopped. Nothing is half-built.

- **Branch:** `rebuild/acropolisos-habitat` (latest: `945e61126`). **`main` is untouched at `0601a04f9` — your fallback.**
- **Full run ledger:** `.opponent-log-acropolisos-rebuild.md` (workspace root) — 16 cycles, every slice + every audit.
- **Architecture contract:** `packages/acropolisos/ARCHITECTURE.md` — read this first for the *why*.
- **Status:** complete, `tsc` at 0, end-to-end integration proof green. Awaiting your review + merge decision.

---

## How to run & verify (do this first)

```bash
# App runs in Docker, dev mode, bind-mounted source
docker ps --filter name=acropolisos-app          # expect: Up (healthy)
# If not running:  cd packages/acropolisos && docker compose up -d

# Open the app
#   http://localhost:3030
#   steward login: steward@acropolisos.local / acropolis2026

# Type-check
docker exec acropolisos-app npx tsc --noEmit      # expect: no output (0 errors)

# THE one command that proves the whole product end-to-end:
docker exec acropolisos-app npx tsx scripts/integration-proof.ts
#   CSV drop → raw_inbox → classify (real LLM) → commit+provenance →
#   the new guest surfaces on the manager's per-user dashboard (metric 12→13)
```

**Manual walkthrough of the live product:**
1. `/connect` → drop/paste a CSV (e.g. `name,email\nJane Doe,jane@x.org`).
2. `/organize` → the row appears unclassified → click **Classify** → review the proposal → **Confirm** (or it flags a near-duplicate → Merge / Create-new).
3. `/` (home) → the committed row shows up on your per-user dashboard (composed from your role's slice).

---

## What's built (slice → key files → proof script)

**Assimilation spine** (the core that makes this not-just-a-coding-agent):

| Slice | What | Key files | Proof |
|---|---|---|---|
| A1 | classify a raw_inbox row → structured `{target_type, field_map, confidence}` proposal (existing types only, zod-enum + field whitelist) | `app/api/organize/classify/route.ts` | `scripts/classify-proof.ts`, `classify-hardening-proof.ts` |
| A2 | human review UI: list unclassified rows, Confirm/Reject/Edit | `app/organize/page.tsx`, `app/organize/proposal-review-list.tsx` | Chrome `/organize` |
| A3 | commit → real typed row + provenance; steward-gated, zod, **idempotent** (`SELECT…FOR UPDATE`); FK-bearing types return `incomplete_required_refs` not a crash | `lib/organize/commit.ts`, `app/organize/actions.ts` | `scripts/confirm-proof.ts` |
| A4 | dedup/resolve ("the moat"): normalized + Levenshtein near-match → human **Merge / Create-new**; `merge_into` validated (exists + right type); merge link → `action_audit` | `lib/organize/resolve.ts`, `commit.ts` | `scripts/resolve-proof.ts` |
| A5 | CSV ingest: quote-aware parser (multiline fields), row cap (413), chunked insert (no pg 65535-param overflow) | `app/api/connect/csv/route.ts` | `scripts/csv-ingest-proof.ts` |

**View layer** (read-only, composition-over-generation):

| Slice | What | Key files | Proof |
|---|---|---|---|
| V1 | typed widget catalog `{configSchema, queryBinding}` (metric/data_table/roster/calendar) + `compose_dashboard`/`resolveDashboard`; in-binding type+field whitelist | `lib/widgets/catalog.ts`, `lib/widgets/compose.ts` | `scripts/widget-proof.ts`, `widget-hardening-proof.ts` |
| V2 | scoped **read-only** data API — `createReadOnlyDataApi` exposes only `count/select/byDate`; bindings get the api, not `db` (write is structurally impossible) | `lib/widgets/read-api.ts` | `scripts/read-api-proof.ts` |
| V3 | **per-user dashboard**: `resolvePerUserDashboard` composes from the member's role `SLICE_SPEC`; explicit `pinned_widgets` override; role-default is the floor if pins go stale; role from session, never a param | `lib/widgets/per-user.ts`, `app/page.tsx` | `scripts/per-user-proof.ts` |

**Integration:** `scripts/integration-proof.ts` (I1, the product walkthrough). I2 deleted the dead F7 no-show chooser.

> Proof scripts are deterministic and self-cleaning (use disposable rows). They're your regression suite — re-run any after a change.

---

## The load-bearing idea (from ARCHITECTURE.md)

**The layer fence:** a *governed core* (world-model, assimilation pipeline, ontology, auth, n8n) that writes, and a *read-only view layer* (widgets/dashboards) that only reads. The view agent's whole world is a read-only, ontology-typed query API — it **physically cannot** corrupt data or schema. The moat is steps 3+4 of assimilation (entity resolution + ontology evolution) because they require the persistent shared world-model a stateless agent can't touch.

---

## Traps (carried gotchas — these will bite you)

- **`generateObject` HANGS with glm-5.1** (OpenCode Zen doesn't support `json_schema` response_format) → use `generateText` + JSON-parse + **zod-validate**. All structured LLM output here does this.
- **ai-SDK v6:** `tool({ inputSchema })` not `parameters`; `convertToModelMessages` is async (`await`).
- **`docker restart acropolisos-app` after editing `app/**/route.ts` or adding `app/` route dirs** — Turbopack serves stale compiled code under the bind mount. `lib/`/`components/` edits hot-reload fine.
- **Proof scripts open the db pool → they don't self-exit.** End them with `process.exit(0)`, or run via `… > /tmp/x.out 2>&1; cat /tmp/x.out` (a `timeout`-killed pipe loses block-buffered stdout → looks like a false "hang").
- **Live DB check:** `docker exec acropolisos-app sh -c 'psql "$DATABASE_URL" -tAc "select …"'` (the var must expand *inside* the container).
- `.env` is gitignored (LLM key lives there). Don't commit it.
- Roles in `SLICE_SPEC` map to `member.tier_role` (manager/supervisor/staff/work_trader); unknown/null role degrades to `staff`.

---

## What to do next

1. **Review the branch** — `git log --oneline main..rebuild/acropolisos-habitat`, run the verification above, walk the product.
2. **Decide on merge.** If you're happy: merge `rebuild/acropolisos-habitat` → `main`. (Consider committing this HANDOVER + the opponent log to the branch first so they travel with it.)
3. **Phase 3 (NOT built — future work):**
   - **Ontology evolution** (assimilation step 4): when incoming data doesn't fit, propose a new field/type through the *governed* ontology path (YAML→codegen), human-approved. Today classify is existing-types-only.
   - **Real n8n action nodes:** the agent can create n8n workflows (`lib/n8n/*`, `lib/agent/n8n-tools.ts`) but they're empty manual-trigger stubs — wire real actions.
   - **Agent-driven `compose_dashboard`:** let the LLM pick widgets for a user (the catalog + read-only api are ready; it just needs an agent tool wired to `compose_dashboard`).
   - **BYOK / multi-install hardening** for real self-hosting.

---

## If you want to resume the autonomous opponent loop

The pattern (it caught 7 real defects this run): two session-only `CronCreate` jobs sharing one `.opponent-log-*.md`.
- **Positiva** (builder, `model: sonnet`) every ~15 min: read log + ARCHITECTURE, pick top TODO (fix any negativa HIGH first), dispatch ONE general-purpose subagent, **reproduce its proof yourself**, commit, log a velocity-ledger line.
- **Negativa** (auditor, `model: opus`) every ~30 min, offset: reproduce the latest DONE's proof, dispatch a bug-finder (≤3 CRITICAL/HIGH findings, each with file:line+repro+fix, +1 positive, 0 allowed).
- **The non-negotiable rule that made it work:** *a cycle with no independently-reproduced proof is a failed cycle.* Never trust the subagent's claim — re-run the proof.

Write a fresh queue first (don't reuse the completed one). Model routing for this project: positiva=sonnet, negativa=opus (see memory `feedback-model-routing-acropolisos`).

---

*Generated at the end of the 16-cycle autonomous rebuild. Full blow-by-blow: `.opponent-log-acropolisos-rebuild.md`.*
