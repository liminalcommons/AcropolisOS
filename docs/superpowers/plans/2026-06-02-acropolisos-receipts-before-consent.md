# acropolisOS — Receipts Before Consent (Foundation gap #5 / Slice plan T8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
> **Status:** Clarification artifact (Doc-DD). NOT yet built — awaiting greenlight to execute. Additive, fence-safe, read-only at render.

**Goal:** Carry the evidence rows that justified each grown field all the way to the steward's consent card, so approving structure shows *"proposed because of these N rows you dropped"* — not just a confidence bar. The engine already gates growth on evidence (`evolve.ts` throws with no evidence); the diff and the card just throw that evidence away.

**Architecture:** Strictly **additive**. `ProposalDiff` gains an optional `evidence` map keyed by **`<PascalType>.<field>`** (the folded critique Medium — multiple grown fields on one type must NOT collapse their receipts under one key). `growDecisionToDiffs` populates it from `op.evidence`/`gp.evidence` (already present, currently ignored). `summarizeProposalDiff` surfaces it; the consent card renders a collapsible per-field receipt. The read fence `lib/ontology/ctx.ts` is **never touched** (sha must stay `6d56c834…43b4f4a`). No new dependency, no new theme token.

**Tech Stack:** zod (`ProposalDiff` schema), TypeScript, vitest (node), React RSC + the existing `inline-proposal-panel.tsx`.

---

## ⚠ ENVIRONMENT PROTOCOL (same as slice-1 — FRANKENSTEIN bind-mount)

- Tests: `docker cp vitest.config.ts acropolisos-app:/app/vitest.config.ts` (once) then `docker exec acropolisos-app npx vitest run <path>`. Type-check: `docker exec acropolisos-app npx tsc --noEmit`. Host `tsc`/`vitest` are broken.
- Component/route edits to be picked up live: `docker restart acropolisos-app` (no inotify). The card change is a normal component edit (no new route file) → recompiles on request; restart only if verifying live.
- NEVER commit `lib/**/*.generated.ts` (`git restore` the CRLF churn before staging). NEVER touch the fence. Commit locally on `loop/overnight-2026-06-01`; NEVER push.

---

## File Structure

| File | Change | Task |
|------|--------|------|
| `lib/proposals/diff.ts` | `ProposalDiff` gains `evidence: z.record(z.string(), z.array(z.string())).default({})`; `emptyDraft()` adds `evidence: {}` | T8a |
| `lib/proposals/diff.test.ts` | parses with/without evidence (back-compat default), `emptyDraft` carries `{}` | T8a |
| `lib/organize/grow-to-proposal.ts` | populate `diff.evidence["<pascal>.<field>"]` from `op.evidence` (additive loop) and `gp.evidence` (structural loop, per sanitized field) | T8b |
| `lib/organize/grow-to-proposal.test.ts` | additive evidence keyed by `Type.field`; **two fields on one type keep separate keys**; structural per-field | T8b |
| the `summarizeProposalDiff` module (imported by `components/inline-proposal-panel.tsx:29` — `grep "export function summarizeProposalDiff"` to locate) | `ProposalDiffSummary` gains an `evidence` passthrough (or per-field `{field, rows[]}` list) | T8c |
| that module's test | summary exposes evidence per `Type.field` | T8c |
| `components/inline-proposal-panel.tsx` | render a collapsible `<details>` "proposed because of these N rows you dropped" per grown field, using governed tokens only | T8d |

---

## Task 8a: `ProposalDiff` carries an optional evidence map (keyed `Type.field`)

**Files:** `lib/proposals/diff.ts`, `lib/proposals/diff.test.ts`

- [ ] **Step 1: Failing test** — add to `lib/proposals/diff.test.ts`:

```ts
import { ProposalDiff, emptyDraft } from "./diff";

describe("ProposalDiff.evidence", () => {
  it("emptyDraft carries an empty evidence map", () => {
    expect(emptyDraft().evidence).toEqual({});
  });
  it("parses a diff WITHOUT evidence (back-compat → defaults to {})", () => {
    const { evidence: _e, ...noEvidence } = emptyDraft();
    expect(ProposalDiff.parse(noEvidence).evidence).toEqual({});
  });
  it("round-trips evidence keyed by Type.field", () => {
    const d = { ...emptyDraft(), evidence: { "Guest.passport": ["raw_inbox:abc"] } };
    expect(ProposalDiff.parse(d).evidence["Guest.passport"]).toEqual(["raw_inbox:abc"]);
  });
});
```

- [ ] **Step 2: RED** — `docker exec acropolisos-app npx vitest run lib/proposals/diff.test.ts` → fails (`evidence` undefined).

- [ ] **Step 3: Implement** — in `lib/proposals/diff.ts`, add to the `ProposalDiff` `z.object({...})` (before `impacted_tables` is fine):

```ts
  // Evidence-before-consent: the raw_inbox row refs that JUSTIFIED each grown
  // field, keyed "<PascalType>.<field>" so multiple grown fields on one type keep
  // SEPARATE receipts (never collapsed under the type). Optional + default {} so
  // every already-persisted proposal still parses. Populated by growDecisionToDiffs.
  evidence: z.record(z.string(), z.array(z.string())).default({}),
```

and add `evidence: {},` to the `emptyDraft()` return literal.

- [ ] **Step 4: GREEN + tsc** — re-run the test (pass) and `docker exec acropolisos-app npx tsc --noEmit`. Fix any ProposalDiff literal the now-present (defaulted) field flags — most fixtures spread `emptyDraft()` or are partials cast to the type; confirm zero NEW errors in touched files.

- [ ] **Step 5: Commit** — `git restore` generated churn; `git add lib/proposals/diff.ts lib/proposals/diff.test.ts`; commit `feat(acropolisos): ProposalDiff carries optional evidence keyed Type.field`.

---

## Task 8b: `growDecisionToDiffs` copies `op.evidence` onto the diff (per field)

**Files:** `lib/organize/grow-to-proposal.ts`, `lib/organize/grow-to-proposal.test.ts`

- [ ] **Step 1: Failing test** — add to `grow-to-proposal.test.ts` (mirror the existing fixtures' `GrowDecision` shape):

```ts
it("additive: copies op.evidence onto the diff keyed Type.field", () => {
  const decision = { autoApply: [
    { kind: "add_optional_field", object_type: "guest", field: "passport", evidence: ["raw_inbox:r1"] },
    { kind: "add_optional_field", object_type: "guest", field: "phone",    evidence: ["raw_inbox:r2"] },
  ], escalate: [] } as GrowDecision;
  const { additive } = growDecisionToDiffs(decision, ONTOLOGY_WITH_GUEST);
  // folded critique Medium: two fields on ONE type keep SEPARATE evidence keys
  expect(additive!.evidence["Guest.passport"]).toEqual(["raw_inbox:r1"]);
  expect(additive!.evidence["Guest.phone"]).toEqual(["raw_inbox:r2"]);
});
it("structural: copies gp.evidence per field on a new type", () => {
  const decision = { autoApply: [], escalate: [
    { kind: "new_type", object_type: "vehicle", fields: ["plate", "make"], evidence: ["raw_inbox:r3"] },
  ] } as GrowDecision;
  const { structural } = growDecisionToDiffs(decision, ONTOLOGY_WITH_GUEST);
  expect(structural!.evidence["Vehicle.plate"]).toEqual(["raw_inbox:r3"]);
  expect(structural!.evidence["Vehicle.make"]).toEqual(["raw_inbox:r3"]);
});
```
(Use the test file's existing ontology fixture for `ONTOLOGY_WITH_GUEST`; `Guest`/`Vehicle` Pascal keys come from `existingPascal`/`snakeToPascal` exactly as the production code resolves them.)

- [ ] **Step 2: RED** — run it → `additive.evidence` is `{}` (evidence never copied).

- [ ] **Step 3: Implement** — in `growDecisionToDiffs`:
  - additive loop, right after `ot.properties[field] = optionalString();`:
    ```ts
    diff.evidence[`${pascal}.${field}`] = op.evidence;
    ```
  - structural loop, inside the `for (const f of gp.fields)` after computing `field` (the sanitized name) and setting `properties[field]`:
    ```ts
    if (field) diff.evidence[`${pascal}.${field}`] = gp.evidence;
    ```
    (Key by the SANITIZED field name so it matches the property key the card iterates.)

- [ ] **Step 4: GREEN + tsc** — re-run; tsc clean.

- [ ] **Step 5: Commit** — `feat(acropolisos): carry grow evidence to the proposal diff (receipts before consent)`.

---

## Task 8c: `summarizeProposalDiff` surfaces evidence

**Files:** the module defining `summarizeProposalDiff` / `ProposalDiffSummary` (locate via `inline-proposal-panel.tsx`'s import at line ~29), + its test.

- [ ] **Step 1: Failing test** — assert the summary exposes evidence keyed `Type.field` (passthrough of `diff.evidence`, or a derived `evidenceByField: Array<{ key: string; rows: string[] }>`). Choose whichever matches the summary's existing shape (arrays of label objects); keep it serializable (plain strings).
- [ ] **Step 2–4: RED → implement passthrough → GREEN + tsc.**
- [ ] **Step 5: Commit** — `feat(acropolisos): summarizeProposalDiff surfaces grow evidence`.

---

## Task 8d: the consent card renders a collapsible receipt per grown field

**Files:** `components/inline-proposal-panel.tsx`

- [ ] **Step 1:** Where the card lists `summary.new_object_types` (around line 197), add a collapsible `<details>` per grown field that has evidence:
  - Summary line: `proposed because of {rows.length} row{s} you dropped`.
  - Expanded: the raw_inbox refs (e.g. `raw_inbox:<id>`) as a plain list. Governed tokens only (`text-muted-foreground`, `border-border`, `bg-card`) — no new token, no palette literal.
- [ ] **Step 2:** Verify live: `docker restart acropolisos-app`, open a pending grow proposal on `:3030` (or the proposals view) and confirm the receipt renders + collapses. (No clean node unit test for the RSC render; the contract is locked by 8a–8c tests + visual check, mirroring slice-1 T4/T5.)
- [ ] **Step 3: Commit** — `feat(acropolisos): consent card shows the evidence behind each grown field`.

---

## Self-Review (controller, before dispatch)

- **Spec coverage:** evidence carried end-to-end (8a schema → 8b populate → 8c summary → 8d render); folded Medium (key by `Type.field`, not `Type`) enforced in 8a's key shape + 8b's test (two fields, separate keys).
- **Type consistency:** key format `"<pascal>.<field>"` identical across 8a/8b/8c/8d; `evidence: Record<string, string[]>` stable.
- **Fence/additive:** no `ctx.ts`; `.default({})` keeps every persisted proposal parsing; render is read-only.
- **No placeholders:** code shown for 8a/8b; 8c/8d depend on the summary module shape (located at execution) — the one "locate via import" instruction is a single grep, acceptable for a one-module passthrough.
