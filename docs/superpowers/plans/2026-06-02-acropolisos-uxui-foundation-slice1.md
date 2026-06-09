# acropolisOS UX/UI Foundation — Slice 1: Totality of States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the render seam *honest* about every async state — give every `ResolvedWidget` a `status: ok | empty | drift | error` set in the resolution seam, stop the two page-level `try{}catch{}` blocks from collapsing "broken" into "empty", and add the four route boundaries (`loading` / `error` / `not-found` / `global-error`) so a failure is never indistinguishable from emptiness.

**Architecture:** Strictly **additive + fence-safe**. The read fence `lib/ontology/ctx.ts` is NEVER touched (sha must stay `6d56c83412b2ebc8344135d4b0782c2bf62b9557940069e476d9fc19ffb43f4a`). The work copies a pattern the code already proved (the `validation_error` → `WidgetErrorCard` drift path) and extends it to a unified discriminant. No new dependencies. No new theme tokens (that is deferred to T10, whose blast-radius is documented below). Opinion stays in the governed widget vocabulary; only the *state representation* grows.

**Tech Stack:** Next.js 16 App Router (RSC), TypeScript, Drizzle, vitest (node env). Tailwind v4 design-token CSS vars.

---

## ⚠ ENVIRONMENT PROTOCOL (FRANKENSTEIN bind-mount — read before any step)

This package runs as a **bind-mounted Docker container** on Windows with **no inotify**. The host toolchain is broken; the container is the source of truth.

| Need | Do | Do NOT |
|------|----|--------|
| Run a test | `docker exec acropolisos-app npx vitest run <path>` | `npx vitest` on host (broken cached vite: "Cannot find module 'vitest/config'") |
| Make `@/` resolve in tests | **Once per session:** `docker cp vitest.config.ts acropolisos-app:/app/vitest.config.ts` (the container `/app` root lacks the config; `lib/`,`app/`,`components/` ARE bind-mounted so edits are live) | rely on host `tsc`/`vitest` |
| Type-check | `docker exec acropolisos-app npx tsc --noEmit` | host `tsc` (@types/node resolution artifact) |
| New **route file** (`app/**/*.tsx`) to be picked up | `docker restart acropolisos-app` then poll `/api/health` or curl `:3030` with `--retry` | assume next-dev hot-reloads it (no inotify on Windows) |
| Editing an existing file already imported | nothing — bind-mount + next-dev recompiles on request | — |
| Generated files re-dirtied (`lib/**/*.generated.ts`, `lib/ontology/ontology.generated.ts`, `lib/agent/tools.generated.ts`) after a `docker restart` | `git restore <those files>` — boot's `regenerate-from-live` rewrites them with a zero-content diff (CRLF churn) | **commit them** |
| The fence `lib/ontology/ctx.ts` | leave untouched; if any diff appears, revert it | edit it for any reason |
| Commits | commit **locally** on branch `loop/overnight-2026-06-01`, one per task, green-before-commit | `git push`, touch `main`, force-push, or `--no-verify` |

Verify live at **http://localhost:3030** (the steward instance). `:3031` (book-club) and `:3032` (empty) are separate instances — do not touch.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `lib/widgets/compose.ts` | Defines `ResolvedWidget`; add `WidgetStatus`, `status`/`error` fields, `isEmptyWidgetData()` helper; wire the `resolveDashboard` seam | T1, T2 |
| `lib/widgets/widget-status.test.ts` (new) | Locks `isEmptyWidgetData` semantics | T1 |
| `lib/widgets/per-user.ts` | Wire the live seam (`runDescriptors`/`resolveDescriptors` + `resolvePerUserDashboard`) | T1, T2 |
| `lib/widgets/per-user.test.ts` | Extend: a throwing binding → `status:"error"` widget (not dropped) | T2 |
| `components/dashboard/ResolvedWidgetCard.tsx` | Add `widgetCardVariant()` + `WidgetLoadErrorCard`; dispatch on `status` | T3 |
| `components/dashboard/widget-card-variant.test.ts` (new) | Locks the dispatch decision (pure, node-testable) | T3 |
| `app/loading.tsx` (new) | Neutral route-level loading (NOT board-shaped) | T4 |
| `app/error.tsx` (new) | Route error boundary (segment/data throws) | T4 |
| `app/not-found.tsx` (new) | Custom 404 | T4 |
| `app/global-error.tsx` (new) | Last-resort boundary for **layout** throws (the folded T4 critique fix) | T4 |
| `app/route-boundaries.test.ts` (new) | Smoke: non-hook boundaries export a function + render an element | T4 |
| `app/page.tsx` | Remove the two error-swallowing `try{}catch{}`; let genuine failures reach `error.tsx` | T5 |

---

## Task 1: `ResolvedWidget` gains a `status` discriminant + `isEmptyWidgetData` helper

**Files:**
- Modify: `lib/widgets/compose.ts` (interface at `:49`; `resolveDashboard` ok-site `:259`, drift-site `:245`)
- Modify: `lib/widgets/per-user.ts` (`runDescriptors` ok-site `:220`, drift-site `:168`)
- Create: `lib/widgets/widget-status.test.ts`
- Touched fixtures: `lib/widgets/compose.test.ts`, `lib/widgets/per-user.test.ts`, `lib/widgets/resolve-intelligence-metric.test.ts` (any literal that builds a `ResolvedWidget` now needs `status`)

- [ ] **Step 1: Write the failing helper test** — `lib/widgets/widget-status.test.ts`

```ts
// Locks the empty-vs-ok rule the seam uses to set status: a metric is NEVER
// "empty" (a count of 0 is a valid measurement), the collection kinds are empty
// only when their backing array/map is empty. Pure — no IO.
import { describe, it, expect } from "vitest";
import { isEmptyWidgetData } from "./compose";

describe("isEmptyWidgetData", () => {
  it("metric / intelligence_metric are never empty", () => {
    expect(isEmptyWidgetData("metric", { value: 0, label: "x" })).toBe(false);
    expect(isEmptyWidgetData("intelligence_metric", { value: 0, label: "x", display: "0%" })).toBe(false);
  });
  it("data_table: empty iff no rows", () => {
    expect(isEmptyWidgetData("data_table", { columns: ["a"], rows: [] })).toBe(true);
    expect(isEmptyWidgetData("data_table", { columns: ["a"], rows: [{ a: 1 }] })).toBe(false);
  });
  it("roster: empty iff no entries", () => {
    expect(isEmptyWidgetData("roster", { fields: ["a"], entries: [] })).toBe(true);
    expect(isEmptyWidgetData("roster", { fields: ["a"], entries: [{ a: 1 }] })).toBe(false);
  });
  it("calendar: empty iff no buckets", () => {
    expect(isEmptyWidgetData("calendar", { date_field: "d", buckets: {} })).toBe(true);
    expect(isEmptyWidgetData("calendar", { date_field: "d", buckets: { "2026-01": [{}] } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — confirm RED** (helper not defined)

```
docker cp vitest.config.ts acropolisos-app:/app/vitest.config.ts
docker exec acropolisos-app npx vitest run lib/widgets/widget-status.test.ts
```
Expected: FAIL — `isEmptyWidgetData is not a function` / import error.

- [ ] **Step 3: Add the type, fields, and helper to `lib/widgets/compose.ts`**

Add above the `ResolvedWidget` interface (after `ComposeDashboardResult`):

```ts
// The single async-state discriminant the renderer dispatches on — the keystone
// of the "totality of states" pillar. Set ONCE in the resolution seam so no
// screen re-derives or swallows it:
//   ok    — data present and non-empty
//   empty — resolved cleanly, but the backing collection has no rows/entries/buckets
//   drift — stored config no longer validates against the ontology (paired with
//           validation_error) — the steward must SEE and fix the broken view
//   error — the data binding threw at resolve time (paired with `error`) — one
//           widget's failure no longer drops it or nukes the whole board
export type WidgetStatus = "ok" | "empty" | "drift" | "error";
```

In the `ResolvedWidget` interface add (keep `validation_error` exactly as-is):

```ts
  status: WidgetStatus;
  // Generic, VIEWER-SAFE message for a status:"error" widget. NEVER the raw
  // exception (that is console.error'd server-side only) — no SQL/internal leak.
  error?: { message: string };
```

Add the exported pure helper near the bottom of `compose.ts` (it must import the data types — they are already imported at the top of the file as `MetricData`, etc.):

```ts
// Is a SUCCESSFULLY-resolved widget's data structurally empty? metric kinds are
// never "empty" (a count of 0 is a measurement); collection kinds are empty when
// their backing array/map is empty. Pure — no IO, no ontology. Used by the seam
// to set status:"empty" vs "ok".
export function isEmptyWidgetData(
  kind: CatalogKind,
  data: MetricData | DataTableData | RosterData | CalendarData,
): boolean {
  switch (kind) {
    case "metric":
    case "intelligence_metric":
      return false;
    case "data_table":
      return (data as DataTableData).rows.length === 0;
    case "roster":
      return (data as RosterData).entries.length === 0;
    case "calendar":
      return Object.keys((data as CalendarData).buckets).length === 0;
    default:
      return false;
  }
}
```

- [ ] **Step 4: Run the helper test — confirm GREEN**

```
docker exec acropolisos-app npx vitest run lib/widgets/widget-status.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Wire `status` at the non-catch construction sites** (the field is now required → tsc will list every site)

`lib/widgets/compose.ts` `resolveDashboard`:
- drift-site (`:245`): add `status: "drift",` to the pushed object.
- ok-site (`:259`): replace the push with status derived from the data —
```ts
      const data = await entry.queryBinding(validation.config as any, api);
      resolved.push({
        id: descriptor.id,
        kind,
        config: descriptor.config,
        data,
        status: isEmptyWidgetData(kind, data) ? "empty" : "ok",
        title: descriptor.title,
      });
```

`lib/widgets/per-user.ts` `runDescriptors`:
- drift-site (`:168`): add `status: "drift",`.
- ok-site (`:220`): the pushed object resolves `resolvedData` first — set
```ts
        status: isEmptyWidgetData(
          kind,
          resolvedData as MetricData | DataTableData | RosterData | CalendarData,
        ) ? "empty" : "ok",
```
  immediately after the `data:` line (import `isEmptyWidgetData` from `./compose` — `per-user.ts` already imports `ResolvedWidget` from there).

- [ ] **Step 6: Fix test fixtures that build a `ResolvedWidget` literal** — add the now-required `status`. Type-check to find them:

```
docker exec acropolisos-app npx tsc --noEmit
```
Add the correct `status` to each flagged literal in `compose.test.ts`, `per-user.test.ts`, `resolve-intelligence-metric.test.ts` (`"drift"` for the validation-error fixtures; `"ok"`/`"empty"` for data fixtures per the data). Re-run `tsc --noEmit` to confirm zero errors in the touched files (a tolerated pre-existing baseline of unrelated errors may remain — do not chase those; confirm none are in files this task touches).

- [ ] **Step 7: Run the widget suite — confirm GREEN**

```
docker exec acropolisos-app npx vitest run lib/widgets/
```
Expected: all widget tests pass (incl. the new helper test).

- [ ] **Step 8: Restore any re-dirtied generated files, then commit**

```
git restore lib/ontology/ontology.generated.ts lib/agent/tools.generated.ts lib/db/schema.generated.ts 2>/dev/null || true
git add lib/widgets/compose.ts lib/widgets/per-user.ts lib/widgets/widget-status.test.ts lib/widgets/compose.test.ts lib/widgets/per-user.test.ts lib/widgets/resolve-intelligence-metric.test.ts
git commit -m "feat(acropolisos): ResolvedWidget gains a status discriminant (ok|empty|drift|error)

Sets status once in the resolution seam (the keystone of the totality-of-states
pillar). isEmptyWidgetData is the pure ok-vs-empty rule; drift sites set 'drift'.
The error path lands in the next task. Fence untouched."
```

---

## Task 2: Catch sites capture `status:"error"` instead of dropping the widget

**Files:**
- Modify: `lib/widgets/compose.ts` (`resolveDashboard` catch `:266`)
- Modify: `lib/widgets/per-user.ts` (`runDescriptors` catch `:230`)
- Modify: `lib/widgets/per-user.test.ts` (add a throwing-binding case)

- [ ] **Step 1: Write the failing test** — append to `lib/widgets/per-user.test.ts`

```ts
describe("resolveDescriptors — a throwing data binding becomes a status:error widget (not dropped)", () => {
  it("surfaces an error widget and does NOT drop it or throw", async () => {
    // A valid metric descriptor (passes validateWidgetConfig) whose queryBinding
    // throws because the db rejects every query. The widget must SURVIVE as
    // status:"error", length preserved, with a generic (non-leaky) message.
    const throwingDb = {
      // read-api funnels reads through these; make them throw to force the catch.
      select() { throw new Error("db down: relation does not exist"); },
      execute() { throw new Error("db down"); },
    } as unknown as never;
    const descriptors = [{ id: "w1", kind: "metric", config: { type: "member", agg: "count" } }];
    const out = await resolveDescriptors(throwingDb, descriptors, () => true);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("error");
    expect(out[0].data).toBeNull();
    expect(out[0].error?.message).toBeTruthy();
    // viewer-safe: the raw exception text must NOT be surfaced
    expect(out[0].error?.message).not.toContain("relation does not exist");
  });
});
```

> Implementer note: `metric`'s `queryBinding` calls the read-api which calls the db. If `select`/`execute` are not the exact methods read-api uses, adjust the stub so the binding genuinely throws (inspect `lib/widgets/read-api.ts` for the db calls). The TEST CONTRACT is fixed; only the stub plumbing may change. The `member` type must exist in the runtime ontology (it does) so validation passes and execution reaches the binding.

- [ ] **Step 2: Run it — confirm RED**

```
docker exec acropolisos-app npx vitest run lib/widgets/per-user.test.ts
```
Expected: FAIL — currently the throwing widget is **dropped** (`out` has length 0), so the length/status assertions fail.

- [ ] **Step 3: Convert both catch sites from drop → capture**

`lib/widgets/per-user.ts` `runDescriptors` catch (`:230`):

```ts
    } catch (e) {
      // A single widget's data binding threw (transient DB error, bad cast). Do
      // NOT drop it (silent vanish) and do NOT let it nuke the whole board:
      // surface a status:"error" widget so the failure is VISIBLE and ISOLATED.
      // The raw error is logged server-side ONLY — never sent to the client.
      console.error(`[widget:${kind}] resolve failed`, e);
      resolved.push({
        id: d.id ?? `derived-${i}`,
        kind,
        config,
        data: null,
        status: "error",
        error: { message: "This widget could not be loaded." },
        title: (d as { title?: string }).title,
      });
    }
```

`lib/widgets/compose.ts` `resolveDashboard` catch (`:266`):

```ts
    } catch (e) {
      console.error(`[widget:${kind}] resolve failed`, e);
      resolved.push({
        id: descriptor.id,
        kind,
        config: descriptor.config,
        data: null,
        status: "error",
        error: { message: "This widget could not be loaded." },
        title: descriptor.title,
      });
    }
```

- [ ] **Step 4: Run the test — confirm GREEN**

```
docker exec acropolisos-app npx vitest run lib/widgets/per-user.test.ts lib/widgets/compose.test.ts
```
Expected: PASS.

- [ ] **Step 5: Restore generated files, commit**

```
git restore lib/ontology/ontology.generated.ts lib/agent/tools.generated.ts lib/db/schema.generated.ts 2>/dev/null || true
git add lib/widgets/per-user.ts lib/widgets/compose.ts lib/widgets/per-user.test.ts
git commit -m "feat(acropolisos): widget binding failures become status:error, not silent drops

A single widget's queryBinding throwing no longer vanishes the widget or nukes
the board — it surfaces as an isolated status:error widget with a viewer-safe
message (raw error logged server-side only). Fence untouched."
```

---

## Task 3: Card dispatches `status:"error"` → token-styled load-error card

**Files:**
- Modify: `components/dashboard/ResolvedWidgetCard.tsx`
- Create: `components/dashboard/widget-card-variant.test.ts`

- [ ] **Step 1: Write the failing test** — `components/dashboard/widget-card-variant.test.ts`

```ts
// The card dispatch is pure and node-testable (no DOM): given a widget's status
// + legacy validation_error, which card variant renders? error wins over drift
// wins over the kind renderer.
import { describe, it, expect } from "vitest";
import { widgetCardVariant } from "./ResolvedWidgetCard";

describe("widgetCardVariant", () => {
  it("status:error → 'error' (load failure beats everything)", () => {
    expect(widgetCardVariant({ status: "error" })).toBe("error");
  });
  it("status:drift → 'drift'", () => {
    expect(widgetCardVariant({ status: "drift" })).toBe("drift");
  });
  it("legacy validation_error (no status) → 'drift' (back-compat)", () => {
    expect(widgetCardVariant({ status: "ok", validation_error: { kind: "x", error: "y" } })).toBe("drift");
  });
  it("status:ok / empty → 'render'", () => {
    expect(widgetCardVariant({ status: "ok" })).toBe("render");
    expect(widgetCardVariant({ status: "empty" })).toBe("render");
  });
});
```

- [ ] **Step 2: Run it — confirm RED**

```
docker exec acropolisos-app npx vitest run components/dashboard/widget-card-variant.test.ts
```
Expected: FAIL — `widgetCardVariant` not exported.

- [ ] **Step 3: Add the variant helper + load-error card; rewire the dispatcher** in `components/dashboard/ResolvedWidgetCard.tsx`

Add the exported pure helper (top of file, after imports):

```ts
// Pure dispatch decision — exported so it is node-testable without a DOM. error
// (a runtime load failure) takes precedence over drift (structural mismatch);
// validation_error is honored for back-compat with any widget built before the
// status field existed.
export function widgetCardVariant(
  w: { status?: import("@/lib/widgets/compose").WidgetStatus; validation_error?: { kind: string; error: string } },
): "error" | "drift" | "render" {
  if (w.status === "error") return "error";
  if (w.status === "drift" || w.validation_error) return "drift";
  return "render";
}
```

Add `WidgetLoadErrorCard` next to `WidgetErrorCard` (uses ONLY the proven token vocabulary — `border-border`, `text-muted-foreground`, `bg-card` — NO new tokens; differentiated from the dashed drift card by a SOLID border):

```tsx
// Rendered when a widget's data binding threw at resolve time (status:"error").
// Distinct from drift (WidgetErrorCard, dashed): a transient/load failure, not a
// structural-config mismatch. Tokens only — no hardcoded palette, no new token.
function WidgetLoadErrorCard({ widget }: { widget: ResolvedWidget }) {
  const label = widget.title ?? prettify(widget.kind);
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-2">
        <span aria-hidden className="text-muted-foreground">⚠</span>
        <p className={TITLE_CLS}>{label}</p>
      </div>
      <p className="text-xs text-foreground mb-1">This widget couldn’t load.</p>
      <p className="text-xs text-muted-foreground">
        {widget.error?.message ?? "Something went wrong fetching its data. Try again shortly."}
      </p>
    </div>
  );
}
```

Rewrite the dispatcher head to use the variant:

```tsx
export function ResolvedWidgetCard({ widget }: { widget: ResolvedWidget }) {
  const variant = widgetCardVariant(widget);
  if (variant === "error") return <WidgetLoadErrorCard widget={widget} />;
  if (variant === "drift") return <WidgetErrorCard widget={widget} />;
  switch (widget.kind) {
    // ... unchanged kind cases ...
  }
}
```

- [ ] **Step 4: Run the test — confirm GREEN**

```
docker exec acropolisos-app npx vitest run components/dashboard/widget-card-variant.test.ts
docker exec acropolisos-app npx tsc --noEmit
```
Expected: variant test PASS; no NEW tsc errors in touched files.

- [ ] **Step 5: Restore generated files, commit**

```
git restore lib/ontology/ontology.generated.ts lib/agent/tools.generated.ts lib/db/schema.generated.ts 2>/dev/null || true
git add components/dashboard/ResolvedWidgetCard.tsx components/dashboard/widget-card-variant.test.ts
git commit -m "feat(acropolisos): card dispatches status:error to a token-styled load-error card

widgetCardVariant() is the pure, node-testable dispatch decision; a runtime load
failure renders distinctly from structural drift, using only governed tokens
(no new theme key — T10 owns that). Fence untouched."
```

---

## Task 4: Route boundaries — `loading` / `error` / `not-found` / `global-error`

**Files (all new):** `app/loading.tsx`, `app/error.tsx`, `app/not-found.tsx`, `app/global-error.tsx`, `app/route-boundaries.test.ts`

> **Folded critique High (T4):** `global-error.tsx` is REQUIRED here. `app/layout.tsx` reads `auth()` / `createCtx` / role OUTSIDE any try/catch; `error.tsx` cannot catch layout throws. Without `global-error.tsx`, a DB outage at boot (the most common real failure) hits Next's default screen and the totality pillar is not closed end-to-end.
>
> **Folded critique Medium (skeleton scope):** `loading.tsx` is shown for EVERY route (`/inbox`, `/graph`, `/audit`, …). It MUST be neutral (a centered spinner), NOT board-shaped — a board skeleton would falsely promise a board on non-board routes. Per-segment skeletons are a documented follow-up, not this slice.

- [ ] **Step 1: Write the smoke test for the non-hook boundaries** — `app/route-boundaries.test.ts`

```ts
// loading.tsx and not-found.tsx are server components with NO hooks, so they can
// be invoked directly in node and must return a React element without throwing.
// (error.tsx / global-error.tsx use useEffect — they are verified LIVE in Step 7,
// since calling a hook outside a renderer throws "Invalid hook call".)
import { describe, it, expect } from "vitest";
import Loading from "./loading";
import NotFound from "./not-found";

describe("route boundaries — non-hook smoke", () => {
  it("loading default export renders an element", () => {
    expect(typeof Loading).toBe("function");
    expect(() => Loading()).not.toThrow();
    expect(Loading()).toBeTruthy();
  });
  it("not-found default export renders an element", () => {
    expect(typeof NotFound).toBe("function");
    expect(() => NotFound()).not.toThrow();
    expect(NotFound()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it — confirm RED** (files don't exist)

```
docker exec acropolisos-app npx vitest run app/route-boundaries.test.ts
```
Expected: FAIL — cannot import `./loading` / `./not-found`.

- [ ] **Step 3: Create `app/loading.tsx`** (neutral, motion-safe)

```tsx
// Neutral route-level loading. Deliberately NOT board-shaped: this boundary is
// shown for EVERY route, so a board skeleton would falsely promise a board on
// /inbox, /graph, /audit, etc. Per-segment skeletons are a follow-up.
export default function Loading() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground motion-reduce:animate-none"
        />
        Loading…
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `app/not-found.tsx`**

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center font-sans">
      <h1 className="text-lg font-semibold text-foreground">Not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">That page doesn’t exist.</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
      >
        Back to your board
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: Create `app/error.tsx`** (segment/data error boundary)

```tsx
"use client";
// Route error boundary — catches throws from page/segment rendering + data. With
// app/page.tsx no longer swallowing resolution failures (Task 5), a DB/ontology
// failure now PROPAGATES here instead of collapsing into a silent empty board.
// Does NOT catch root-layout throws — that is global-error.tsx's job.
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center font-sans">
      <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This view couldn’t load. The error has been logged.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
      >
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Create `app/global-error.tsx`** (the folded fix — must render its own `<html>`/`<body>`, inline styles only)

```tsx
"use client";
// LAST-RESORT boundary: catches throws in the ROOT LAYOUT itself (app/layout.tsx
// runs auth()/createCtx/role reads OUTSIDE any try/catch). error.tsx cannot catch
// layout throws, so without this a DB outage AT BOOT — the most common real
// failure — hits Next's default error screen. This closes the totality pillar
// end-to-end. global-error REPLACES the layout, so it must render its own
// <html>/<body>; the theme stylesheet may not have loaded → INLINE styles only.
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
          margin: 0,
        }}
      >
        <div style={{ maxWidth: 420, margin: "0 auto", padding: "64px 24px", textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>acropolisOS is temporarily unavailable</h1>
          <p style={{ marginTop: 8, fontSize: 14, opacity: 0.7 }}>
            The app couldn’t start this request — usually a database or
            configuration issue. The error has been logged.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              padding: "8px 16px",
              fontSize: 14,
              borderRadius: 6,
              border: "1px solid #333",
              background: "transparent",
              color: "#fafafa",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Pick up the new route files + verify (smoke test GREEN, live boundaries render)**

New route files need a restart (no inotify):
```
docker restart acropolisos-app
# wait for healthy, then:
docker exec acropolisos-app npx vitest run app/route-boundaries.test.ts
git restore lib/ontology/ontology.generated.ts lib/agent/tools.generated.ts lib/db/schema.generated.ts 2>/dev/null || true
```
Expected: smoke test PASS.

Live boundary checks (curl `:3030` after restart is healthy):
```
# not-found: a bogus path should render the custom 404 (look for "Back to your board")
curl -s -L --retry 5 --retry-delay 2 http://localhost:3030/__definitely_not_a_route__ | grep -o "Back to your board" || echo "NOT-FOUND not wired"
```
(`error.tsx`/`global-error.tsx` are validated by inspection here — a forced throw is destabilizing on the live steward instance; the next slice's tasks that change `page.tsx` exercise `error.tsx` naturally.)

- [ ] **Step 8: Commit**

```
git add app/loading.tsx app/error.tsx app/not-found.tsx app/global-error.tsx app/route-boundaries.test.ts
git commit -m "feat(acropolisos): route boundaries — loading/error/not-found + global-error

Closes the keystone gap end-to-end: a neutral (non-board) loading state, a
segment error boundary, a custom 404, and global-error.tsx catching ROOT-LAYOUT
throws (the folded critique High — error.tsx can't catch layout failures, the
most common real outage). Fence untouched."
```

---

## Task 5: `app/page.tsx` stops catching failures into a silent empty board

**Files:** Modify `app/page.tsx` (steward branch `:127`–`:161`; member branch `:243`–`:254`)

**Why this is now safe (verified):** `readOrgDashboard()` is fully fail-soft (returns `{widgets:[]}` on missing/corrupt, never throws); the cold-board blocker count already has `.catch(() => 0)`; per-widget binding failures are absorbed as `status:"error"` (Task 2). The ONLY remaining throw-capable calls — `resolveApprovedViews(new PgApprovedViewsRegistry(db), …)` and `resolveDescriptors`/`resolvePerUserDashboard` — represent genuine DB/ontology-down failures that SHOULD reach `error.tsx`, not masquerade as an empty org.

> There is no clean automated unit test for an RSC's try/catch removal. This task is verified by **inspection + live**: (1) the catch blocks are gone; (2) the happy path still renders at `:3030`; (3) `tsc` clean on the file. The contract is locked by the existence of `error.tsx`/`global-error.tsx` (Task 4) — together they are the regression guard.

- [ ] **Step 1: Steward branch — remove the swallowing wrapper** (`app/page.tsx:127`–`:161`)

Delete the `let widgets: ResolvedWidget[] = []; try { … } catch { /* Non-fatal */ }` framing and let the body run directly:

```tsx
    // No board-level catch: readOrgDashboard is fail-soft, the optional blocker
    // count keeps its own .catch(() => 0), and per-widget binding failures are
    // already status:"error" widgets (lib/widgets). A genuine DB/ontology outage
    // here PROPAGATES to app/error.tsx — an empty board must never mask a broken
    // one (the totality-of-states keystone).
    let descriptors: unknown[];
    if (previewing) {
      descriptors = deriveDefaultBoard(ontology, canReadType, { admin: false });
    } else {
      const stored = await readOrgDashboard();
      if (stored.widgets.length > 0) {
        descriptors = stored.widgets;
      } else {
        const api = createReadOnlyDataApi(db, canReadType, ontology);
        const blockerCount = await api.count("agent_blocker").catch(() => 0);
        const floor = adminDefaultBoard(ontology, canReadType, {
          hasBlockerHistory: blockerCount > 0,
        });
        const approved = await resolveApprovedViews(
          new PgApprovedViewsRegistry(db),
          { id: actor.userId, role: actor.role },
          canReadType,
        );
        descriptors = mergeApprovedIntoFloor(floor, approved);
      }
    }
    const widgets: ResolvedWidget[] = await resolveDescriptors(db, descriptors, canReadType);
```

(The `widgets.length === 0` empty-state branch below is UNCHANGED — but it now means *genuinely* empty, never "maybe broken".)

- [ ] **Step 2: Member branch — remove the swallowing wrapper** (`app/page.tsx:243`–`:254`)

```tsx
  const canReadType = buildCanReadType(actor, ontology);
  // No catch: a genuine resolution failure PROPAGATES to app/error.tsx rather
  // than rendering a misleading empty slice (totality-of-states keystone).
  const widgets: ResolvedWidget[] = await resolvePerUserDashboard(
    db,
    { id: me.id, tier_role: me.tier_role },
    canReadType,
    new PgApprovedViewsRegistry(db),
  );
```

- [ ] **Step 3: Type-check + live verify the happy path**

```
docker exec acropolisos-app npx tsc --noEmit
git restore lib/ontology/ontology.generated.ts lib/agent/tools.generated.ts lib/db/schema.generated.ts 2>/dev/null || true
# steward home still renders (200, has the board chrome):
curl -s -L --retry 5 --retry-delay 2 -o /dev/null -w "%{http_code}\n" http://localhost:3030/
```
Expected: no NEW tsc errors in `page.tsx`; `/` returns 200 (or 307 to /signin if the curl session is anon — both are non-500). If 500, STOP — a fail-soft assumption was wrong; report it.

- [ ] **Step 4: Commit**

```
git add app/page.tsx
git commit -m "fix(acropolisos): page.tsx stops catching resolution failures into an empty board

Removes the two try{}catch{} that collapsed broken→empty. Genuine DB/ontology
failures now reach app/error.tsx (Task 4); per-widget failures are status:error
widgets (Task 2); fail-soft paths (readOrgDashboard, blocker count) keep their
own guards. Empty never masks broken again. Fence untouched."
```

---

## Self-Review (controller, before dispatch)

- **Spec coverage:** T1 status field + helper (Pillar 1, keystone) ✓; T2 error capture (gap #1) ✓; T3 card dispatch ✓; T4 four boundaries incl. folded `global-error` ✓ + neutral loading (folded Medium) ✓; T5 un-swallow (gap #1) ✓.
- **Type consistency:** `WidgetStatus` defined in compose.ts (T1), imported by the card (T3); `isEmptyWidgetData(kind, data)` signature stable across T1 uses; `error?: { message }` set in T2, read in T3.
- **No placeholders:** every code step shows complete code; every command shows expected output.
- **Fence:** no task touches `lib/ontology/ctx.ts`.

---

## Folded into the plan for later tasks (NOT built in this slice)

The 3 critique High + 3 Medium findings, recorded here so they are correct when T6–T11 are scheduled:

### T6 — Move Empty/Seeded/Live home onto `/`; delete `/ontology-editor`
- **Folded Medium:** the orphaned route branches on **3** inputs incl. `pendingCount`; the new home helper must take all 3 — an org with pending proposals (the "watch it solidify" moment) must NOT be misclassified as "seeded".

### T7 — Member front door + Focus via the same `DecisionFocus` primitive; delete dead `blocker-card.tsx`
- **Folded High:** `DecisionFocus` consumes `DecisionView[]` built by `buildDecisionView`; `/me`'s source returns a DIFFERENT shape and the action signatures differ. This is a real **adapter** (map `/me`'s data → `DecisionView`, wire member dispositions to the correct actions), NOT a drop-in reuse. Naive reuse type-errors or wires the wrong actions. Also depends on RoleSwitch correctness (gap #12, Low) for the `?as=` member preview.

### T8 — Receipts (`op.evidence`) reach the consent card
- **Folded Medium:** key evidence by `type.field`, NOT by `type` — multiple grown fields must not collapse their receipts under one key.

### T9 — Global a11y floor (`:focus-visible` ring, `prefers-reduced-motion`, skip link)

### T10 — Close the color vocabulary (semantic status roles + destructive-fg)
- **Folded High (blast radius):** adding token keys is NOT local. Every consumer of the strict 18-key contract must be updated together or themes silently fall back to base and swept classes render colorless:
  - `lib/theme/presets.ts` — `THEME_PRESETS` (6 presets) + any length/shape assertion in `presets.test.ts`.
  - `lib/theme/tokens.ts` — `BASE_TOKENS` (and its `TOKEN_KEYS`/length invariant + `tokens.test.ts`).
  - `lib/theme/design.ts` — the separate token schema (+ `design.test.ts`).
  - `app/globals.css` — the `:root`, `.dark`, AND `@theme inline` var blocks (all three must gain the new keys, or Tailwind classes won't resolve).
  - `lib/theme/contrast.ts` — every new role needs a contrast-checked foreground against the WCAG floor (the existing color guardrail pattern).
  - Treat as one atomic change with all theme tests updated in lockstep.

### T11 — Sweep the 126 hardcoded palette literals onto the new tokens (depends on T10)

### Known-deferred foundational gaps (explicit gate — do NOT silently drop)
- **#8** ungoverned `org-dashboard.json` file write inside the render path — gated by: a governance decision on whether org-board composition becomes a proposal-reviewed change.
- **#14** null reversibility before-state — gated by: capturing per-row action outcomes (a write-path change, out of this read-focused arc).
- **#15** kernel domain-type contamination — gated by: a decontamination pass like the storage-layer one (commit `074b67e7f`).
- **Coverage asymmetry (Low):** the write/dispose half of "machine proposes, human disposes" has not been audited for the same totality-of-states discipline — schedule a parallel audit before declaring the foundation closed.
