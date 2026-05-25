# acropolisOS Phase 4 — Tier-2 Arrangement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a member a UI affordance on the per-user dashboard (`app/page.tsx`) to remove, reorder (up/down), and re-add widgets — writing only to `member_context.pinned_widgets` through the existing `compose_dashboard`, never inventing structure.

**Architecture:** A pure transform layer (`lib/widgets/arrange.ts`) operates on an ordered `ArrangeItem[]` (`{id, kind, config}`). The current arrangement is re-derived server-side from `resolvePerUserDashboard` (authoritative; client never sends configs). Server actions apply one operation, then persist the full new ordered list via `compose_dashboard` (which reassigns IDs and validates against the catalog). A client edit-mode component renders per-widget controls and an "add from your role's catalog" menu. The read-only data fence and role-default floor are untouched.

**Tech Stack:** Next.js App Router (RSC + server actions), React 19, Drizzle, vitest (`@/` alias configured), lucide-react, Tailwind v4 semantic tokens.

**Governance note (Axiom 1 / Tier-2 boundary):** The addable menu is exactly `SLICE_SPEC[role]` — the member arranges within the governed catalog for their role; they cannot author new configs (that would be Tier 3, explicitly out of scope). No new widget *kinds*. This replaces the *absence* of an arrangement affordance; it adds no new persistence surface (reuses `pinned_widgets`).

---

## File structure

| File | Responsibility | New/Modify |
|---|---|---|
| `lib/widgets/arrange.ts` | Pure transforms + `currentArrangement` + `addableForRole` | Create |
| `lib/widgets/arrange.test.ts` | Vitest for the pure transforms | Create |
| `app/arrange-actions.ts` | `"use server"` actions: move / remove / add | Create |
| `components/dashboard/widget-controls.tsx` | Client edit-mode controls + add menu | Create |
| `app/page.tsx` | Wire edit-mode toggle + controls into render | Modify |

---

### Task 1: Pure arrangement transforms + derivation helpers

**Files:**
- Create: `lib/widgets/arrange.ts`
- Test: `lib/widgets/arrange.test.ts`

Context: `WidgetSelection = { kind: CatalogKind; config: unknown }` (`lib/widgets/compose.ts:35`). `SLICE_SPEC: Record<TierRole, SliceDescriptor[]>` where `SliceDescriptor = { kind: CatalogKind; config: unknown }` (`lib/widgets/per-user.ts:44,60`). `resolvePerUserDashboard(db, {id, tier_role}): Promise<ResolvedWidget[]>` where `ResolvedWidget = { id, kind, config, data }` (`compose.ts:44`). `TierRole = "manager"|"supervisor"|"staff"|"work_trader"` with unknown → `"staff"`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/widgets/arrange.test.ts
import { describe, it, expect } from "vitest";
import { moveItem, removeItem, addItem, toSelections, addableForRole, type ArrangeItem } from "./arrange";

const items: ArrangeItem[] = [
  { id: "a", kind: "metric", config: { type: "guest", agg: "count" } },
  { id: "b", kind: "roster", config: { type: "shift", fields: ["label"], limit: 10 } },
  { id: "c", kind: "data_table", config: { type: "guest", columns: ["full_name"], limit: 15 } },
];

describe("moveItem", () => {
  it("moves up", () => {
    expect(moveItem(items, "b", "up").map((i) => i.id)).toEqual(["b", "a", "c"]);
  });
  it("moves down", () => {
    expect(moveItem(items, "b", "down").map((i) => i.id)).toEqual(["a", "c", "b"]);
  });
  it("no-op at top edge moving up", () => {
    expect(moveItem(items, "a", "up").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("no-op at bottom edge moving down", () => {
    expect(moveItem(items, "c", "down").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("unknown id is a no-op", () => {
    expect(moveItem(items, "zzz", "up")).toEqual(items);
  });
});

describe("removeItem", () => {
  it("removes by id", () => {
    expect(removeItem(items, "b").map((i) => i.id)).toEqual(["a", "c"]);
  });
  it("unknown id is a no-op", () => {
    expect(removeItem(items, "zzz")).toEqual(items);
  });
});

describe("addItem", () => {
  it("appends a selection with a fresh id", () => {
    const next = addItem(items, { kind: "metric", config: { type: "member", agg: "count" } });
    expect(next).toHaveLength(4);
    expect(next[3].kind).toBe("metric");
    expect(next[3].id).toBeTruthy();
  });
});

describe("toSelections", () => {
  it("strips ids", () => {
    expect(toSelections(items)).toEqual(items.map(({ kind, config }) => ({ kind, config })));
  });
});

describe("addableForRole", () => {
  it("returns the role's SLICE_SPEC as selections", () => {
    const m = addableForRole("manager");
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((s) => typeof s.kind === "string")).toBe(true);
  });
  it("unknown role falls back to staff", () => {
    expect(addableForRole("nope")).toEqual(addableForRole("staff"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec acropolisos-app npx vitest run lib/widgets/arrange.test.ts`
Expected: FAIL — cannot find module `./arrange`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/widgets/arrange.ts
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/db/client";
import type { CatalogKind } from "./catalog";
import { type WidgetSelection } from "./compose";
import { resolvePerUserDashboard, SLICE_SPEC, type TierRole } from "./per-user";

export interface ArrangeItem {
  id: string;
  kind: CatalogKind;
  config: unknown;
}

function resolveRole(role: string): TierRole {
  return (role as TierRole) in SLICE_SPEC ? (role as TierRole) : "staff";
}

export function moveItem(items: ArrangeItem[], id: string, dir: "up" | "down"): ArrangeItem[] {
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return items;
  const target = dir === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

export function removeItem(items: ArrangeItem[], id: string): ArrangeItem[] {
  if (!items.some((i) => i.id === id)) return items;
  return items.filter((i) => i.id !== id);
}

export function addItem(items: ArrangeItem[], sel: WidgetSelection): ArrangeItem[] {
  return [...items, { id: randomUUID(), kind: sel.kind, config: sel.config }];
}

export function toSelections(items: ArrangeItem[]): WidgetSelection[] {
  return items.map(({ kind, config }) => ({ kind, config }));
}

export function addableForRole(role: string): WidgetSelection[] {
  return SLICE_SPEC[resolveRole(role)].map((d) => ({ kind: d.kind, config: d.config }));
}

// Server-authoritative current arrangement: derive from the resolved dashboard
// (reflects explicit pins, or materializes the role default) and keep ids+config.
export async function currentArrangement(
  db: Database,
  member: { id: string; tier_role: string },
): Promise<ArrangeItem[]> {
  const resolved = await resolvePerUserDashboard(db, member);
  return resolved.map((w) => ({ id: w.id, kind: w.kind, config: w.config }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec acropolisos-app npx vitest run lib/widgets/arrange.test.ts`
Expected: PASS (all cases). If vitest cannot resolve `@/` for the db import chain, confirm `vitest.config.ts` has the `@/` alias (memory: acropolisOS vitest needs explicit `@/` alias). The pure transforms don't touch db, but the module imports `Database` type + `per-user` — type-only `Database` import is erased; `per-user` pulls `schema.generated`. If that import chain breaks the test env, split the pure transforms (`moveItem/removeItem/addItem/toSelections/addableForRole`) into `arrange.ts` and keep `currentArrangement` (the only db-touching fn) in the same file but ensure the test only imports the pure fns — vitest still loads the whole module. If load fails, move `currentArrangement` to `lib/widgets/arrange-server.ts` and re-export; test only `arrange.ts`.

- [ ] **Step 5: Type-check + commit**

Run: `docker exec acropolisos-app npx tsc --noEmit` → expect exit 0.
```bash
cd /c/flur_workspace/packages/acropolisos
git add lib/widgets/arrange.ts lib/widgets/arrange.test.ts
git commit -m "feat(acropolisos): P4 — pure widget-arrangement transforms + derivation"
```

---

### Task 2: Server actions (move / remove / add)

**Files:**
- Create: `app/arrange-actions.ts`

Context — mirror the established server-action pattern in `app/dashboard/ask/actions.ts` (`pinWidget`, line 51): `"use server"` → `buildChatRuntime()` (`lib/agent/chat-runtime.ts:89`) → `isAnonymous(runtime.actor)` guard (`:85`) → member id is `runtime.actor.userId`. For catalog widgets the correct writer is `compose_dashboard(db, memberId, selections)` (`lib/widgets/compose.ts:69`) — it validates + upserts `pinned_widgets`. Get the db via `getDb()` (`@/lib/db/client`). Look up the member row for `tier_role` the same way `app/page.tsx:223-232` does (`db.select(...).from(member).where(eq(member.id, actor.userId))`). After write, `revalidatePath("/")`.

- [ ] **Step 1: Write the implementation**

```ts
// app/arrange-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { member as memberTable } from "@/lib/db/schema.generated";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { compose_dashboard } from "@/lib/widgets/compose";
import {
  currentArrangement,
  moveItem,
  removeItem,
  addItem,
  toSelections,
  addableForRole,
} from "@/lib/widgets/arrange";

async function resolveMember() {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  const db = getDb();
  const rows = await db
    .select({ id: memberTable.id, tier_role: memberTable.tier_role })
    .from(memberTable)
    .where(eq(memberTable.id, runtime.actor.userId))
    .limit(1);
  if (rows.length === 0) throw new Error("no_member_row");
  return { db, member: rows[0] };
}

export async function moveWidgetAction(id: string, dir: "up" | "down"): Promise<void> {
  const { db, member } = await resolveMember();
  const next = moveItem(await currentArrangement(db, member), id, dir);
  await compose_dashboard(db, member.id, toSelections(next));
  revalidatePath("/");
}

export async function removeWidgetAction(id: string): Promise<void> {
  const { db, member } = await resolveMember();
  const next = removeItem(await currentArrangement(db, member), id);
  await compose_dashboard(db, member.id, toSelections(next));
  revalidatePath("/");
}

// index is the position in addableForRole(role); resolved server-side so the
// client never sends a config blob (governance: arrange within the catalog).
export async function addWidgetAction(addableIndex: number): Promise<void> {
  const { db, member } = await resolveMember();
  const menu = addableForRole(member.tier_role);
  const sel = menu[addableIndex];
  if (!sel) throw new Error("invalid_addable_index");
  const next = addItem(await currentArrangement(db, member), sel);
  await compose_dashboard(db, member.id, toSelections(next));
  revalidatePath("/");
}

export async function resetArrangementAction(): Promise<void> {
  const { db, member } = await resolveMember();
  // Empty pins → resolvePerUserDashboard falls back to the role-default floor.
  await compose_dashboard(db, member.id, []);
  revalidatePath("/");
}
```

- [ ] **Step 2: Type-check**

Run: `docker exec acropolisos-app npx tsc --noEmit` → expect exit 0.
Note: confirm `isAnonymous` and `buildChatRuntime` export names against `lib/agent/chat-runtime.ts` and that `runtime.actor.userId` is the field (Actor type `lib/ctx.ts:8`). If `compose_dashboard([])` with an empty array is treated as `validation_error` vs `ok` — read `compose.ts:102` (errors only push on invalid entries; empty list → `errors.length === 0` → writes `"[]"`). Good: empty list is valid and resets to floor.

- [ ] **Step 3: Commit**
```bash
cd /c/flur_workspace/packages/acropolisos
git add app/arrange-actions.ts
git commit -m "feat(acropolisos): P4 — arrangement server actions over compose_dashboard"
```

---

### Task 3: Client edit-mode controls + add menu

**Files:**
- Create: `components/dashboard/widget-controls.tsx`

Context: client component. Receives the current widgets (id + kind + a human label) and the role's addable menu (index + kind + label). Renders an "Arrange" toggle; in edit mode each widget row shows ▲ ▼ ✕ buttons wired to the server actions; an "Add widget" section lists addable entries as buttons. Use lucide-react icons (`ArrowUp`, `ArrowDown`, `X`, `Plus`, `Settings2`), semantic token classes only (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-primary`, `bg-primary/15`). Use `useTransition` so actions show pending state. Server actions are async `void`; call them in `startTransition`.

- [ ] **Step 1: Write the implementation**

```tsx
// components/dashboard/widget-controls.tsx
"use client";

import { useState, useTransition } from "react";
import { ArrowUp, ArrowDown, X, Plus, Settings2, RotateCcw } from "lucide-react";
import {
  moveWidgetAction,
  removeWidgetAction,
  addWidgetAction,
  resetArrangementAction,
} from "@/app/arrange-actions";

export interface ArrangeWidgetRow {
  id: string;
  label: string;
}
export interface AddableRow {
  index: number;
  label: string;
}

export function WidgetControls({
  widgets,
  addable,
}: {
  widgets: ArrangeWidgetRow[];
  addable: AddableRow[];
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition-colors ${
            editing ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {editing ? "Done arranging" : "Arrange"}
        </button>
        {editing && (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => resetArrangementAction())}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to default
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-3 space-y-3 rounded-lg border border-border bg-card p-3">
          <ul className="space-y-1.5">
            {widgets.map((w, i) => (
              <li
                key={w.id}
                className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground"
              >
                <span className="truncate">{w.label}</span>
                <span className="flex items-center gap-1">
                  <IconBtn
                    label="Move up"
                    disabled={pending || i === 0}
                    onClick={() => startTransition(() => moveWidgetAction(w.id, "up"))}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Move down"
                    disabled={pending || i === widgets.length - 1}
                    onClick={() => startTransition(() => moveWidgetAction(w.id, "down"))}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Remove"
                    disabled={pending}
                    onClick={() => startTransition(() => removeWidgetAction(w.id))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </IconBtn>
                </span>
              </li>
            ))}
          </ul>

          {addable.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Add from your catalog
              </p>
              <div className="flex flex-wrap gap-1.5">
                {addable.map((a) => (
                  <button
                    key={a.index}
                    type="button"
                    disabled={pending}
                    onClick={() => startTransition(() => addWidgetAction(a.index))}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" /> {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Type-check + commit**

Run: `docker exec acropolisos-app npx tsc --noEmit` → expect exit 0.
```bash
cd /c/flur_workspace/packages/acropolisos
git add components/dashboard/widget-controls.tsx
git commit -m "feat(acropolisos): P4 — client widget-arrangement controls"
```

---

### Task 4: Wire controls into the dashboard page

**Files:**
- Modify: `app/page.tsx`

Context: `app/page.tsx` is a server component (`export default async function Home()`, line 210). It already computes `const widgets = await resolvePerUserDashboard(db, { id, tier_role })` (~line 252) and renders `<WidgetCard widget={w} />`. Add a `widgetLabel(w)` helper (human label from kind+config) and the controls above the widget grid.

- [ ] **Step 1: Add a label helper near the top of the file (module scope)**

```tsx
import { addableForRole } from "@/lib/widgets/arrange";
import { WidgetControls } from "@/components/dashboard/widget-controls";
// ...
function widgetLabel(kind: string, config: unknown): string {
  const c = (config ?? {}) as { type?: string; agg?: string };
  const type = c.type ? c.type.replace(/_/g, " ") : "";
  switch (kind) {
    case "metric":
      return `${c.agg ?? "count"} of ${type || "items"}`;
    case "data_table":
      return `${type || "data"} table`;
    case "roster":
      return `${type || "items"} roster`;
    case "calendar":
      return `${type || "items"} calendar`;
    default:
      return kind;
  }
}
```

- [ ] **Step 2: Render the controls above the widget grid**

In the render, after `widgets` is resolved and before the grid of `WidgetCard`s, insert:

```tsx
<WidgetControls
  widgets={widgets.map((w) => ({ id: w.id, label: widgetLabel(w.kind, w.config) }))}
  addable={addableForRole(tier_role).map((s, index) => ({
    index,
    label: widgetLabel(s.kind, s.config),
  }))}
/>
```

(Use the same `tier_role` variable the page already resolved for `resolvePerUserDashboard`. If the page splits metrics vs others into two sections, place `<WidgetControls>` once, above both sections.)

- [ ] **Step 3: Type-check**

Run: `docker exec acropolisos-app npx tsc --noEmit` → expect exit 0.

- [ ] **Step 4: Restart container (page is a route — Turbopack stale-route trap)**

Run: `docker restart acropolisos-app` (memory: editing `app/**` routes needs a restart; lib/components hot-reload).

- [ ] **Step 5: Commit**
```bash
cd /c/flur_workspace/packages/acropolisos
git add app/page.tsx
git commit -m "feat(acropolisos): P4 — wire arrangement controls into per-user dashboard"
```

---

### Task 5: Verification (manual + regression)

**Files:** none (verification only)

- [ ] **Step 1: Regression — arrangement proof**

The pure transforms are unit-tested (Task 1). For the round-trip, run the existing per-user proof to confirm the data path + precedence still hold:
Run: `docker exec acropolisos-app npx tsx scripts/per-user-proof.ts`
Expected: all CASES pass (pinned-override, all-invalid→floor, partial-invalid→keep-valid unchanged).

- [ ] **Step 2: tsc**

Run: `docker exec acropolisos-app npx tsc --noEmit` → exit 0.

- [ ] **Step 3: Manual visual check (controller does this via Chrome tools; do NOT order the user)**

At http://localhost:3030 (logged in as steward@acropolisos.local): the dashboard shows an "Arrange" button. Toggling it reveals up/down/remove per widget + an "Add from your catalog" row. Removing a widget re-renders without it; moving reorders; adding appends; "Reset to default" restores the role floor. Verify the controls use the themed palette (no raw zinc). Confirm no console errors.

- [ ] **Step 4: Report to the user for their visual verification.** Phase 4 complete.

---

## Self-review checklist (controller, before dispatch)

- Spec coverage: pin/unpin(remove)/reorder ✔, add-from-catalog ✔, server action wraps `compose_dashboard` ✔, writes only `pinned_widgets` ✔, role-default floor preserved (reset = empty pins) ✔, drag-drop explicitly deferred ✔.
- Type consistency: `ArrangeItem`, `WidgetSelection`, `toSelections`, `addableForRole`, action names used identically across Tasks 1→4. ✔
- No placeholders. ✔
