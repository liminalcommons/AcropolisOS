# acropolisOS — Channel Connection Management UI (Telegram + Discord) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is the **last-mile** feature before acropolisOS is "done"; quality + the security fence matter more than speed.

**Goal:** Give the single-org install a real management UI for its bound Telegram groups and Discord servers — see which groups / channels / threads are connected and pipelined into acropolisOS, down to the sub-channel, with an honest "is it actually working" liveness signal per binding.

**Architecture:** Strictly **inbound + fence-safe**. The security-reviewed webhook routes stay byte-identical. **Discovery and liveness are *derived by reading `raw_inbox`*** (a group becomes "discovered" the moment its first message arrives carrying `chat_id`/`guild_id` + title). A new infra table `channel_bindings` stores only the steward's curation decision (which discovered group/sub is allow-listed, its label, on/off). "Working" = a pure function of *secret-configured (not 503)* + *messages received* + *last-received age*. Discord is slash-command-pipelined today; passive Discord channel messages (Gateway) are an explicit deferred phase, surfaced in the UI as "needs Gateway", never faked.

**Tech Stack:** Drizzle (Postgres infra table, hand-managed like `raw_inbox`), TypeScript, zod, vitest (node), Next 16 App Router RSC + client components, the governed theme-token vocabulary (no palette literals, no new token).

---

## ⚠ ENVIRONMENT PROTOCOL (FRANKENSTEIN bind-mount — read before any task)

- **Tests run IN-CONTAINER.** Host `tsc`/`vitest` are broken. Once per container: `docker cp vitest.config.ts acropolisos-app:/app/vitest.config.ts`. Then `docker exec acropolisos-app npx vitest run <path>` and `docker exec acropolisos-app npx tsc --noEmit` (0 = clean).
- **New infra table ⇒ entrypoint rebuild.** `drizzle-kit push` **silently skips new-table creation**, and the entrypoint is **baked into the image**. So Task A1 wires a hand-rolled `CREATE TABLE IF NOT EXISTS` into `docker-entrypoint.sh`, and verifying it live needs **`docker compose ... up --build`**, NOT `docker restart`. (Restart will NOT pick up an entrypoint change and the table will be absent.)
- **Component/route edits picked up live** need `.next` cleared then restart — **`docker exec acropolisos-app sh -lc 'rm -rf .next/* .next/.[!.]* 2>/dev/null'` then `docker restart acropolisos-app`** (a bare restart on a stale `.next` 404s the whole app; `.next` is a mount point so clear its CONTENTS, not the dir).
- **NEVER** commit `lib/**/*.generated.ts` — `git restore` the CRLF churn before staging. **NEVER** touch the read fence `lib/ontology/ctx.ts` (sha256 must stay `6d56c83412b2ebc8344135d4b0782c2bf62b9557940069e476d9fc19ffb43f4a`) or anything under `lib/auth`. Commit locally on `loop/overnight-2026-06-01`; **NEVER push, NEVER touch main**.

---

## 🔒 SECURITY INVARIANTS — MUST be preserved by every task

1. **Data-only fence:** the webhook routes (`app/api/channels/{telegram,discord}/route.ts`) and adapters write ONLY to `raw_inbox` via `ingestChannelRows`. No authenticated reads, no ontology ctx, no agent actions, **no sender→actor mapping at intake**. This plan does **not** modify the webhook routes' control flow.
2. **No bot token in the running app / no outbound:** the app holds no bot token and makes no outbound provider call. This plan adds **zero** outbound. (Discord Gateway = deferred.)
3. **The verify gates are untouched:** Telegram constant-time secret compare (`lib/channels/telegram/adapter.ts` `verifyRequest`/`constantTimeEqual`), Discord Ed25519 over the raw body (`verify.ts`), inert-503-when-unset, PING→PONG-before-parse, Discord wire-body = interaction-response object only. Task A2 widens ONLY `parsePayload`'s captured fields — `verifyRequest` stays byte-identical.
4. **Bindings management is steward-gated** (mirror `app/api/organize/grow/route.ts`'s steward gate) and **reads/writes only `channel_bindings` + reads `raw_inbox`** — never the ontology fence, never auth.

---

## File Structure

| File | Change | Task |
|------|--------|------|
| `lib/db/schema.ts` | add `channel_bindings` pgTable (infra, hand-managed, beside `raw_inbox`) | A1 |
| `docker-entrypoint.sh` | hand-rolled `CREATE TABLE IF NOT EXISTS channel_bindings` + unique index + post-check | A1 |
| `lib/db/schema.test.ts` (or new `lib/channels/bindings.test.ts`) | table shape / insert round-trip | A1 |
| `lib/channels/telegram/adapter.ts` | **additively** capture `chat.title`, `chat.type`, `message_thread_id` in `parsePayload` (verify untouched) | A2 |
| `lib/channels/telegram/types.ts` | add the read-only fields (`Chat.title`, `Chat.type`, `Message.message_thread_id`) | A2 |
| `lib/channels/telegram/adapter.test.ts` (+ integration test) | asserts new fields captured; verify/secret tests unchanged | A2 |
| `lib/channels/discovery.ts` | **NEW** — read-only aggregation of `raw_inbox` → discovered groups + sub-channels + liveness | A3 |
| `lib/channels/discovery.test.ts` | **NEW** — seeded raw_inbox → grouped discovery + counts + last/first seen | A3 |
| `lib/channels/status.ts` | **NEW** — pure `bindingLiveness(input) → BindingStatus` (offline/receiving/idle/awaiting/unbound) | A3 |
| `lib/channels/status.test.ts` | **NEW** — each status branch | A3 |
| `lib/channels/bindings.ts` | **NEW** — store: `listBindings`, `bindTarget`, `ignoreTarget`, `setEnabled`, `relabel` (+ `mergeDiscoveryWithBindings`) | B1 |
| `lib/channels/bindings.test.ts` | **NEW** — CRUD + uniqueness + merge view | B1 |
| `app/api/channels/bindings/route.ts` | **NEW** — GET (merged view) + POST (bind/ignore/toggle/relabel), **steward-gated**, anon-rejected | B2 |
| `app/api/channels/bindings/route.test.ts` | **NEW** — steward-gated; anon → 401/403; bad action → 400 | B2 |
| `lib/channels/eligibility.ts` | **NEW** — `boundSourceFilter` used by batch-classify/grow eligibility (soft allow-list) | B3 |
| `app/api/organize/batch-classify/route.ts` | filter sampled sources to bound-only (additive, behind the binding view) | B3 |
| `lib/channels/fetchers/channels-view.ts` | **NEW** — server fetcher: steward-scoped merged channels view for the page | C1 |
| `app/channels/page.tsx` | **NEW** — the management surface (RSC), governed tokens only | C2 |
| `components/channels/*` | **NEW** — `ChannelGroupCard`, `BindingStatusPill`, `BindingActions` (client) | C3 |
| `app/connect/page.tsx` or board card | surface a **Channels** entry → `/channels` | C4 |

---

## PHASE A — Data model + discovery/liveness read layer

### Task A1: `channel_bindings` infra table + entrypoint creation

**Files:** `lib/db/schema.ts`, `docker-entrypoint.sh`, a test file.

- [ ] **Step 1: Failing test** — new `lib/channels/bindings.test.ts` (uses the in-container DB the same way existing infra tests do; if no DB harness, assert the Drizzle table object's column names/types instead — mirror how `raw_inbox` is tested):

```ts
import { channel_bindings } from "@/lib/db/schema";
describe("channel_bindings table", () => {
  it("exposes the binding columns", () => {
    const cols = Object.keys(channel_bindings);
    for (const c of ["id","platform","scope","external_id","sub_id","title","label","status","enabled","created_at","updated_at"])
      expect(cols).toContain(c);
  });
});
```

- [ ] **Step 2: RED** — run it → `channel_bindings` undefined.

- [ ] **Step 3: Implement** — in `lib/db/schema.ts`, beside `raw_inbox` (this is a hand-managed infra table, explicitly NOT in `schema.generated.ts`):

```ts
// Steward's curation of which DISCOVERED channel targets are allow-listed into the
// org. Infra table (hand-managed, like raw_inbox) — NOT in schema.generated.ts and
// NOT created by drizzle-kit push (it silently skips new tables); see docker-entrypoint.sh.
// sub_id "" = the whole group/server; a non-empty sub_id is a Telegram topic /
// Discord channel|thread. status "bound" = pipelined; "ignored" = muted.
export const channel_bindings = pgTable("channel_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: text("platform").notNull(),            // "telegram" | "discord"
  scope: text("scope").notNull(),                  // "group" | "topic" | "channel" | "thread"
  external_id: text("external_id").notNull(),      // chat_id (telegram) | guild_id (discord)
  sub_id: text("sub_id").notNull().default(""),    // topic/channel/thread id; "" = whole group
  title: text("title"),                            // last-seen human title snapshot
  label: text("label"),                            // steward label
  status: text("status").notNull().default("bound"), // "bound" | "ignored"
  enabled: boolean("enabled").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("channel_bindings_unique").on(t.platform, t.external_id, t.sub_id),
}));
export type ChannelBindingRow = typeof channel_bindings.$inferSelect;
export type ChannelBindingInsert = typeof channel_bindings.$inferInsert;
```
(Ensure `uniqueIndex`, `boolean` are imported from `drizzle-orm/pg-core`.)

- [ ] **Step 4: Entrypoint creation** — in `docker-entrypoint.sh`, in the same pre-apply `psql` block that hand-creates other infra tables (search for the `raw_inbox` / `approved_views` `CREATE TABLE IF NOT EXISTS` loop), add:

```sql
CREATE TABLE IF NOT EXISTS channel_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  scope text NOT NULL,
  external_id text NOT NULL,
  sub_id text NOT NULL DEFAULT '',
  title text,
  label text,
  status text NOT NULL DEFAULT 'bound',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS channel_bindings_unique
  ON channel_bindings (platform, external_id, sub_id);
```
Add a post-create existence check mirroring the existing `check_column`/table checks so a missing table fails loudly at boot.

- [ ] **Step 5: GREEN + tsc** — re-run the test; `docker exec acropolisos-app npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit** — `git restore` generated churn; stage ONLY `lib/db/schema.ts docker-entrypoint.sh lib/channels/bindings.test.ts`; commit `feat(acropolisos): channel_bindings infra table + entrypoint creation`.

### Task A2: Telegram adapter additively captures title + topic (verify untouched)

**Files:** `lib/channels/telegram/adapter.ts`, `lib/channels/telegram/types.ts`, the adapter/integration tests.

- [ ] **Step 1: Failing test** — extend `lib/channels/telegram/adapter.test.ts`: a `SAMPLE_UPDATE` whose `message.chat` has `title:"Hostel Ops"`, `type:"supergroup"`, and `message.message_thread_id: 42` → `parsePayload` row contains `chat_title:"Hostel Ops"`, `chat_type:"supergroup"`, `message_thread_id: 42`. **Also add/keep an assertion that `verifyRequest` with a wrong/absent secret still returns false** (proves the gate is untouched).

- [ ] **Step 2: RED** — run → new fields absent.

- [ ] **Step 3: Implement** — in `types.ts` add `title?: string; type?: string` to `Chat` and `message_thread_id?: number` to `Message` (read-only, additive). In `adapter.ts` `rowFromMessage`, add the three fields to the returned object **only** (do NOT touch `verifyRequest`, `constantTimeEqual`, or the `update_id` validation). Use `?? undefined` so absent fields are simply omitted (no NOT-NULL surprises downstream — the payload is jsonb).

- [ ] **Step 4: GREEN + tsc** — re-run adapter + the telegram integration test (must stay green, additively). tsc 0.

- [ ] **Step 5: Commit** — `feat(acropolisos): telegram intake captures group title + topic id (additive, verify untouched)`.

### Task A3: discovery + liveness read layer (pure, over raw_inbox)

**Files:** `lib/channels/discovery.ts`, `lib/channels/status.ts` (+ tests).

- [ ] **Step 1: Failing tests** —
  - `discovery.test.ts`: given seeded `raw_inbox` rows (`source:"telegram"`, payloads with `chat_id`/`chat_title`/`message_thread_id`; `source:"discord"` with `guild_id`/`channel_id`), `discoverChannels(db)` returns, per platform, a list of groups `{ platform, externalId, title, messageCount, firstReceivedAt, lastReceivedAt, subChannels: [{ subId, scope, title?, messageCount, lastReceivedAt }] }`. Counts + max/min timestamps correct; rows missing an id are bucketed under an `"(unknown)"` group, not dropped.
  - `status.test.ts`: `bindingLiveness({ configured, bound, messageCount, lastReceivedAt, now })` returns: `"offline"` when `!configured`; `"unbound"` when `!bound`; `"awaiting"` when bound & `messageCount===0`; `"receiving"` when bound & last-seen ≤ 24h; `"idle"` when bound & last-seen > 24h. Pure — `now` injected (no `Date.now()` in the module).

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement** —
  - `discovery.ts`: a read-only function using Drizzle aggregates over `raw_inbox` (group by `payload->>'chat_id'` etc. via `sql` expressions, or fetch-and-reduce in JS if the SQL-json path is awkward — correctness over cleverness; this is read-only). NO writes, NO ontology, NO auth.
  - `status.ts`: the pure function above + a `BindingStatus` union type. `configured` is passed in by the caller (which reads `process.env.TELEGRAM_WEBHOOK_SECRET` / `DISCORD_PUBLIC_KEY` — the same flags the routes 503 on), so this module stays env-free and unit-testable.

- [ ] **Step 4: GREEN + tsc.**

- [ ] **Step 5: Commit** — `feat(acropolisos): derive channel discovery + liveness from raw_inbox (read-only)`.

**Phase A gate (controller):** after A3, run the full theme/widget/channel suites in-container to confirm no regressions, confirm fence sha unchanged, then proceed to Phase B (expanded at launch).

---

## PHASE B — Bindings CRUD + allow-list (steward-gated) — *expanded at phase launch*

- **B1 `lib/channels/bindings.ts`:** `listBindings(db)`, `bindTarget(db, {platform,scope,external_id,sub_id,title,label})` (upsert on the unique index), `ignoreTarget`, `setEnabled`, `relabel`, and `mergeDiscoveryWithBindings(discovery, bindings, { configured, now })` → the view the UI renders (each discovered target tagged bound/unbound/ignored + a `BindingStatus`). Pure merge + thin store calls. Tests: CRUD, uniqueness (re-bind same target updates, not duplicates), merge correctness.
- **B2 `app/api/channels/bindings/route.ts`:** GET → merged steward-scoped view; POST `{action: "bind"|"ignore"|"toggle"|"relabel", ...}`. **Steward-gated exactly like `app/api/organize/grow/route.ts`** (copy its session/role check; anon → 401/403). Reads `raw_inbox` (discovery) + `channel_bindings` only. Tests: anon rejected, non-steward rejected, bad action → 400, happy path persists.
- **B3 `lib/channels/eligibility.ts` + batch-classify filter:** a soft allow-list — `batch-classify` samples only rows whose `(platform, chat_id/guild_id)` is `bound && enabled`. Additive, behind the binding view; unbound discovery still visible, just not auto-pipelined. Test: ignored/unbound source excluded from the sample.

---

## PHASE C — The management UI — *expanded at phase launch; ends in USER VISUAL SIGN-OFF*

- **C1 `lib/channels/fetchers/channels-view.ts`:** server fetcher composing discovery + bindings + liveness for the steward.
- **C2 `app/channels/page.tsx`:** RSC. Per-platform sections (Telegram, Discord); each group a card with its sub-channels (topics/channels/threads), a `BindingStatusPill`, and bind/ignore/relabel/toggle actions. Discord regular channels with no Gateway show a quiet `⚠ needs Gateway to pipeline messages` note (never a fake live state). **Governed tokens only** (success/warning/destructive/muted-foreground/border/card) — no palette literal, no new token.
- **C3 `components/channels/*`:** `BindingStatusPill` (maps `BindingStatus` → token + label), `ChannelGroupCard`, `BindingActions` (client; POSTs to the bindings API, optimistic + refresh).
- **C4:** surface a **Channels** entry on `/connect` (replace/augment the disabled stubs) and/or a board card → `/channels`.
- **C-verify:** `docker compose ... up --build` (entrypoint changed in A1!), confirm `channel_bindings` exists, `/channels` renders for a steward, webhooks still 503/401 correctly, fence sha intact. **Present the rendered UI + an honest status walkthrough for USER VISUAL SIGN-OFF before declaring done.**

---

## PHASE D — Verify + deploy

- [ ] `docker compose -f docker-compose.yml ... up --build -d` (rebuild — entrypoint baked).
- [ ] Confirm table: `docker exec acropolisos-db psql ... -c '\d channel_bindings'`.
- [ ] Health: `/signin` 200, `/api/channels/telegram` POST without secret → 503 (still inert), `/channels` renders for steward.
- [ ] `npx tsc --noEmit` 0; full suite no NEW failures vs baseline.
- [ ] Fence sha `6d56c834…43b4f4a` intact; `git ls-files | grep .env` = only `.env.example`; no generated files committed.
- [ ] Present for sign-off. **Then acropolisOS is "done."**

---

## Self-Review

- **Spec coverage:** "good UI to manage connections" → C2/C3; "what groups/channels/threads connected" → A3 discovery (group + sub-channel) + B1 merge; "pipelined into acropolisOS" → existing raw_inbox→grow path + B3 allow-list; "actually working" → A3 `bindingLiveness` (honest derived status, no fake green). Discord depth = "fence-safe now" → slash-command pipelining + `needs Gateway` note, Gateway deferred.
- **Fence/additive:** webhook routes' control flow untouched (A2 widens only `parsePayload` captured fields, verify byte-identical); `ctx.ts` never touched; new table is additive infra; bindings API steward-gated, reads raw_inbox + channel_bindings only.
- **Type consistency:** `BindingStatus` union shared A3↔B1↔C3; binding key `(platform, external_id, sub_id)` with `sub_id ""`=whole-group consistent across schema, store upsert, unique index, and merge.
- **Env discipline:** in-container tests; entrypoint change ⇒ `up --build` (not restart); generated churn restored; local commits only, never pushed.
