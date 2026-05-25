# acropolisOS UI Rework (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the debug-looking dashboard with a governed three-region app shell (collapsible left nav · center dashboard · right AI co-pilot dock) and make the entire UI runtime-themeable by migrating hardcoded `zinc-*` classes to the existing CSS-variable token system, shipping one base palette.

**Architecture:** A server-resolved `<AppShell>` wraps every authenticated page. It resolves the member's theme (one base palette for now, precedence-resolved) and emits it as inline CSS variables, so Tailwind's semantic token classes (`bg-background`, `text-foreground`, …) re-skin the whole app from one place. The chat panel is repositioned from a fixed-bottom strip into a collapsible right dock. No world-model writes — theming/arrangement touch only `member_context`.

**Tech Stack:** Next.js App Router (RSC), React 19, Tailwind CSS v4 (`@theme inline` + oklch CSS vars), Drizzle ORM + Postgres, vitest, lucide-react, `@ai-sdk/react`.

**Scope:** Phases 1–3 of the spec (shell, token migration, base theming plumbing). Phase 4 (arrangement UI) and Phase 5 (AI color-designer agent) are separate follow-on plans.

**Spec:** `packages/acropolisos/docs/superpowers/specs/2026-05-25-acropolisos-ui-rework-design.md`

**Conventions for every task:** run commands from `packages/acropolisos`. Type-check is `docker exec acropolisos-app npx tsc --noEmit`. Tests are `docker exec acropolisos-app npx vitest run <path>`. After editing any `app/**/route.ts` or adding route dirs, `docker restart acropolisos-app` (Turbopack stale-route trap); `lib/`/`components/` edits hot-reload. Visual checks are at http://localhost:3030 (steward: `steward@acropolisos.local` / `acropolis2026`).

---

## File Structure

**Create:**
- `lib/theme/tokens.ts` — `TokenSet` type, `TOKEN_KEYS`, `BASE_TOKENS` (the one palette), `isValidTokenSet`, `parseTokenSet`.
- `lib/theme/resolve.ts` — `resolveTheme({ memberPref, role, orgSeed })` precedence resolver.
- `lib/theme/resolve.test.ts` — precedence unit tests.
- `lib/theme/tokens.test.ts` — validation/parse unit tests.
- `lib/theme/css.ts` — `tokenSetToCssVars(tokens)` → inline style object for the shell root.
- `components/shell/app-shell.tsx` — server component; the three-region grid + theme emission.
- `components/shell/left-nav.tsx` — client; nav links + collapse + bell + account.
- `components/shell/co-pilot-dock.tsx` — client; collapsible wrapper hosting `<ChatPanel/>`.
- `components/shell/shell-state.ts` — localStorage helpers for nav/dock collapse.

**Modify:**
- `lib/db/schema.generated.ts:104-110` — add `theme_pref text` to `member_context`.
- `lib/db/migrate.ts` (or the bootstrap that runs DDL) — `ALTER TABLE member_context ADD COLUMN IF NOT EXISTS theme_pref text`.
- `app/layout.tsx:41-56` — wrap `{children}` in `<AppShell>`; remove the direct bottom `<ChatPanel/>` mount (moves into the dock).
- `components/chat-panel.tsx:401-409` — change the outer `<aside>` from fixed-bottom strip to fill-its-container (the dock controls position/visibility).
- 21 page/component files — `zinc-*`/literal colors → semantic token classes (Task 7+).

---

## Task 1: TokenSet type + base palette

**Files:**
- Create: `lib/theme/tokens.ts`
- Test: `lib/theme/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/theme/tokens.test.ts
import { describe, it, expect } from "vitest";
import { TOKEN_KEYS, BASE_TOKENS, isValidTokenSet, parseTokenSet } from "@/lib/theme/tokens";

describe("tokens", () => {
  it("BASE_TOKENS defines every token key", () => {
    for (const k of TOKEN_KEYS) {
      expect(typeof BASE_TOKENS[k]).toBe("string");
      expect(BASE_TOKENS[k].length).toBeGreaterThan(0);
    }
  });

  it("isValidTokenSet accepts BASE_TOKENS", () => {
    expect(isValidTokenSet(BASE_TOKENS)).toBe(true);
  });

  it("isValidTokenSet rejects a set missing a key", () => {
    const { background: _omit, ...partial } = BASE_TOKENS;
    expect(isValidTokenSet(partial)).toBe(false);
  });

  it("isValidTokenSet rejects non-string values", () => {
    expect(isValidTokenSet({ ...BASE_TOKENS, primary: 123 })).toBe(false);
  });

  it("parseTokenSet returns null on invalid JSON", () => {
    expect(parseTokenSet("{not json")).toBeNull();
  });

  it("parseTokenSet round-trips BASE_TOKENS", () => {
    expect(parseTokenSet(JSON.stringify(BASE_TOKENS))).toEqual(BASE_TOKENS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec acropolisos-app npx vitest run lib/theme/tokens.test.ts`
Expected: FAIL — cannot find module `@/lib/theme/tokens`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/theme/tokens.ts
//
// The governed theming vocabulary. The token KEYS (names/roles) are invariant —
// they mirror the CSS variables in app/globals.css. A "theme" is any valid
// TokenSet: the base palette here, or one an agent generates later (Phase 5).
// Only VALUES vary; structure never does. (Spec §3.)

export const TOKEN_KEYS = [
  "background", "foreground",
  "card", "card-foreground",
  "popover", "popover-foreground",
  "primary", "primary-foreground",
  "secondary", "secondary-foreground",
  "muted", "muted-foreground",
  "accent", "accent-foreground",
  "destructive",
  "border", "input", "ring",
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];
export type TokenSet = Record<TokenKey, string>;

// The one base palette = the .dark token values already in globals.css :root/.dark.
// acropolisOS ships dark-first; these oklch values match the existing .dark block.
export const BASE_TOKENS: TokenSet = {
  background: "oklch(0.141 0.005 285.823)",
  foreground: "oklch(0.985 0 0)",
  card: "oklch(0.21 0.006 285.885)",
  "card-foreground": "oklch(0.985 0 0)",
  popover: "oklch(0.21 0.006 285.885)",
  "popover-foreground": "oklch(0.985 0 0)",
  primary: "oklch(0.62 0.19 280)",
  "primary-foreground": "oklch(0.985 0 0)",
  secondary: "oklch(0.274 0.006 286.033)",
  "secondary-foreground": "oklch(0.985 0 0)",
  muted: "oklch(0.274 0.006 286.033)",
  "muted-foreground": "oklch(0.705 0.015 286.067)",
  accent: "oklch(0.274 0.006 286.033)",
  "accent-foreground": "oklch(0.985 0 0)",
  destructive: "oklch(0.704 0.191 22.216)",
  border: "oklch(1 0 0 / 10%)",
  input: "oklch(1 0 0 / 15%)",
  ring: "oklch(0.552 0.016 285.938)",
};

export function isValidTokenSet(value: unknown): value is TokenSet {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  if (Object.keys(rec).length !== TOKEN_KEYS.length) return false;
  for (const k of TOKEN_KEYS) {
    if (typeof rec[k] !== "string" || (rec[k] as string).length === 0) return false;
  }
  return true;
}

export function parseTokenSet(raw: string | null | undefined): TokenSet | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidTokenSet(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec acropolisos-app npx vitest run lib/theme/tokens.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/theme/tokens.ts lib/theme/tokens.test.ts
git commit -m "feat(acropolisos): theming TokenSet vocabulary + base palette"
```

---

## Task 2: Theme precedence resolver

**Files:**
- Create: `lib/theme/resolve.ts`
- Test: `lib/theme/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/theme/resolve.test.ts
import { describe, it, expect } from "vitest";
import { resolveTheme } from "@/lib/theme/resolve";
import { BASE_TOKENS } from "@/lib/theme/tokens";

const customPref = JSON.stringify({ ...BASE_TOKENS, primary: "oklch(0.7 0.2 30)" });

describe("resolveTheme", () => {
  it("uses a valid explicit member pref over everything", () => {
    const t = resolveTheme({ memberPref: customPref, role: "manager", orgSeed: null });
    expect(t.primary).toBe("oklch(0.7 0.2 30)");
  });

  it("falls back to base when member pref is null", () => {
    const t = resolveTheme({ memberPref: null, role: "staff", orgSeed: null });
    expect(t).toEqual(BASE_TOKENS);
  });

  it("falls back to base when member pref is corrupt", () => {
    const t = resolveTheme({ memberPref: "{garbage", role: "staff", orgSeed: null });
    expect(t).toEqual(BASE_TOKENS);
  });

  it("falls back to base when member pref is an invalid TokenSet", () => {
    const t = resolveTheme({ memberPref: JSON.stringify({ primary: "x" }), role: "staff", orgSeed: null });
    expect(t).toEqual(BASE_TOKENS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec acropolisos-app npx vitest run lib/theme/resolve.test.ts`
Expected: FAIL — cannot find module `@/lib/theme/resolve`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/theme/resolve.ts
//
// Precedence (spec §3): explicit member pref → per-role default → data-derived
// seed → base. Phase 3 ships only the base palette, so role/orgSeed currently
// resolve to BASE_TOKENS; the seams exist for Phase 5 without changing callers.

import { BASE_TOKENS, parseTokenSet, type TokenSet } from "./tokens";

export interface ThemeInputs {
  memberPref: string | null | undefined; // member_context.theme_pref (TokenSet JSON)
  role: string | null | undefined;       // member.tier_role
  orgSeed: string | null | undefined;    // reserved for data-derived (Phase 5)
}

// Per-role defaults — identical to base for now (one palette). Seam for Phase 5.
function roleDefault(_role: string | null | undefined): TokenSet {
  return BASE_TOKENS;
}

// Data-derived seed — reserved; returns null until Phase 5.
function seedToTokens(_seed: string | null | undefined): TokenSet | null {
  return null;
}

export function resolveTheme(inputs: ThemeInputs): TokenSet {
  const explicit = parseTokenSet(inputs.memberPref);
  if (explicit) return explicit;
  const seeded = seedToTokens(inputs.orgSeed);
  if (seeded) return seeded;
  return roleDefault(inputs.role);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec acropolisos-app npx vitest run lib/theme/resolve.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/theme/resolve.ts lib/theme/resolve.test.ts
git commit -m "feat(acropolisos): theme precedence resolver (pref > role > seed > base)"
```

---

## Task 3: `theme_pref` column on `member_context`

**Files:**
- Modify: `lib/db/schema.generated.ts:104-110`
- Modify: the bootstrap DDL path (`lib/db/migrate.ts` or equivalent — grep first, Step 1)

- [ ] **Step 1: Locate the bootstrap DDL**

Run: `docker exec acropolisos-app sh -c "grep -rl 'member_context' lib/db"`
Read the file that issues `CREATE TABLE`/`ALTER` for tables (the bootstrap/migrate). Confirm where `member_context` is created. theming is a UI preference, NOT a world-model entity → plain column, not the ontology codegen path (spec decision Q1).

- [ ] **Step 2: Add the column to the Drizzle schema**

In `lib/db/schema.generated.ts`, inside `member_context` (after `pinned_widgets`):

```ts
export const member_context = pgTable("member_context", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  member_id: uuid("member_id").notNull().references((): AnyPgColumn => member.id),
  pinned_widgets: text("pinned_widgets").notNull().default("[]"),
  theme_pref: text("theme_pref"), // nullable TokenSet JSON; null = base palette
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
});
```

- [ ] **Step 3: Add the idempotent ALTER to the bootstrap**

In the bootstrap DDL file from Step 1, alongside the other `member_context` DDL, add (memory: schema-drift gotcha — every new column needs an explicit ALTER):

```sql
ALTER TABLE member_context ADD COLUMN IF NOT EXISTS theme_pref text;
```

(Match the surrounding style — if the file runs DDL via a tagged template / array of statements, add it there.)

- [ ] **Step 4: Apply and verify the column exists live**

Run: `docker restart acropolisos-app` (lets the bootstrap run), then:
`docker exec acropolisos-app sh -c 'psql "$DATABASE_URL" -tAc "SELECT column_name FROM information_schema.columns WHERE table_name=\047member_context\047 AND column_name=\047theme_pref\047"'`
Expected: prints `theme_pref`.

- [ ] **Step 5: Type-check**

Run: `docker exec acropolisos-app npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.generated.ts lib/db/migrate.ts
git commit -m "feat(acropolisos): member_context.theme_pref column (nullable TokenSet JSON)"
```

---

## Task 4: TokenSet → CSS variables

**Files:**
- Create: `lib/theme/css.ts`
- Test: `lib/theme/css.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/theme/css.test.ts
import { describe, it, expect } from "vitest";
import { tokenSetToCssVars } from "@/lib/theme/css";
import { BASE_TOKENS } from "@/lib/theme/tokens";

describe("tokenSetToCssVars", () => {
  it("maps each token key to a --kebab CSS variable", () => {
    const vars = tokenSetToCssVars(BASE_TOKENS);
    expect(vars["--background"]).toBe(BASE_TOKENS.background);
    expect(vars["--primary-foreground"]).toBe(BASE_TOKENS["primary-foreground"]);
    expect(vars["--muted-foreground"]).toBe(BASE_TOKENS["muted-foreground"]);
  });

  it("produces exactly one var per token key", () => {
    const vars = tokenSetToCssVars(BASE_TOKENS);
    expect(Object.keys(vars)).toHaveLength(18);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec acropolisos-app npx vitest run lib/theme/css.test.ts`
Expected: FAIL — cannot find module `@/lib/theme/css`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/theme/css.ts
import { TOKEN_KEYS, type TokenSet } from "./tokens";
import type { CSSProperties } from "react";

// The token keys already match globals.css variable names (kebab), so the
// CSS var is just `--${key}`. Returned object is spread onto a style={} prop.
export function tokenSetToCssVars(tokens: TokenSet): CSSProperties {
  const out: Record<string, string> = {};
  for (const k of TOKEN_KEYS) out[`--${k}`] = tokens[k];
  return out as CSSProperties;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec acropolisos-app npx vitest run lib/theme/css.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/theme/css.ts lib/theme/css.test.ts
git commit -m "feat(acropolisos): TokenSet → inline CSS variables"
```

---

## Task 5: Shell collapse state helpers

**Files:**
- Create: `components/shell/shell-state.ts`
- Test: `components/shell/shell-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// components/shell/shell-state.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NAV_KEY, DOCK_KEY, readCollapsed, writeCollapsed } from "@/components/shell/shell-state";

describe("shell-state", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });

  it("defaults to not-collapsed when unset", () => {
    expect(readCollapsed(NAV_KEY)).toBe(false);
    expect(readCollapsed(DOCK_KEY)).toBe(false);
  });

  it("round-trips a collapsed=true write", () => {
    writeCollapsed(NAV_KEY, true);
    expect(readCollapsed(NAV_KEY)).toBe(true);
  });

  it("reads false when localStorage throws", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(readCollapsed(NAV_KEY)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec acropolisos-app npx vitest run components/shell/shell-state.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// components/shell/shell-state.ts
export const NAV_KEY = "acro.nav.collapsed";
export const DOCK_KEY = "acro.dock.collapsed";

export function readCollapsed(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeCollapsed(key: string, collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, collapsed ? "1" : "0");
  } catch {
    // private browsing / quota — ignore
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec acropolisos-app npx vitest run components/shell/shell-state.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/shell/shell-state.ts components/shell/shell-state.test.ts
git commit -m "feat(acropolisos): shell collapse-state localStorage helpers"
```

---

## Task 6: The app shell (nav + dock + theme emission)

> No unit test — this is composition + layout, verified visually in Step 5. `tsc` is the static gate.

**Files:**
- Create: `components/shell/left-nav.tsx`, `components/shell/co-pilot-dock.tsx`, `components/shell/app-shell.tsx`
- Modify: `components/chat-panel.tsx:401-409`, `app/layout.tsx`

- [ ] **Step 1: Reposition the chat panel into a fill-container element**

In `components/chat-panel.tsx`, change ONLY the outer `<aside>` (lines ~401-409). Replace the fixed-bottom strip classes + the expand/`h-11` height logic with a fill-parent panel; the dock owns position and visibility. Keep the inner structure (header/scroll/form) — it already uses absolute positioning inside the aside, which fills a tall dock correctly.

```tsx
    <aside
      aria-label="Chat panel"
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden",
        "border-l border-border bg-card text-card-foreground",
      )}
    >
```

Then delete the now-unused `expanded`/`streaming`-height animation state (`expanded`, the `setExpanded` effect at ~265-274) ONLY if unused elsewhere — the streaming pulse in the header keys off `streaming`, keep that. The history pane (`absolute inset-x-0 top-0 bottom-11`) and form (`absolute bottom-0 h-11`) stay; in a full-height dock they lay out top-to-bottom as intended. (Clean break: do not keep the fixed-bottom variant.)

- [ ] **Step 2: Create the co-pilot dock**

```tsx
// components/shell/co-pilot-dock.tsx
"use client";

import { useEffect, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { ChatPanel } from "@/components/chat-panel";
import { DOCK_KEY, readCollapsed, writeCollapsed } from "./shell-state";
import type { BuiltInRole } from "@/lib/auth/users";

interface Props {
  actorRole: BuiltInRole | null;
  actorEmail?: string;
  modelName?: string;
}

export function CoPilotDock({ actorRole, actorEmail, modelName }: Props): React.ReactNode {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(readCollapsed(DOCK_KEY)), []);

  const toggle = (): void => {
    setCollapsed((c) => {
      const next = !c;
      writeCollapsed(DOCK_KEY, next);
      return next;
    });
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label="Open co-pilot"
        className="flex h-full w-10 shrink-0 items-center justify-center border-l border-border bg-card text-muted-foreground hover:text-foreground"
      >
        <PanelRightOpen className="h-4 w-4" aria-hidden />
      </button>
    );
  }

  return (
    <div className="relative flex h-full w-[340px] shrink-0 flex-col">
      <button
        type="button"
        onClick={toggle}
        aria-label="Collapse co-pilot"
        className="absolute right-2 top-2 z-10 text-muted-foreground hover:text-foreground"
      >
        <PanelRightClose className="h-4 w-4" aria-hidden />
      </button>
      <ChatPanel actorRole={actorRole} actorEmail={actorEmail} modelName={modelName} />
    </div>
  );
}
```

- [ ] **Step 3: Create the left nav**

```tsx
// components/shell/left-nav.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home, Inbox, Plug, Network, Users, Bell,
  PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_KEY, readCollapsed, writeCollapsed } from "./shell-state";

const ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/organize", label: "Organize", icon: Inbox },
  { href: "/connect", label: "Connect", icon: Plug },
  { href: "/ontology", label: "Ontology", icon: Network },
  { href: "/me", label: "People", icon: Users },
] as const;

export function LeftNav({ memberName, role }: { memberName: string; role: string }): React.ReactNode {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(readCollapsed(NAV_KEY)), []);

  const toggle = (): void => {
    setCollapsed((c) => {
      const next = !c;
      writeCollapsed(NAV_KEY, next);
      return next;
    });
  };

  return (
    <nav
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-card text-card-foreground transition-[width] duration-150",
        collapsed ? "w-14" : "w-56",
      )}
      aria-label="Primary"
    >
      <div className="flex items-center gap-2 px-3 py-4">
        <span className="text-lg font-bold text-foreground">◆</span>
        {!collapsed && <span className="font-semibold tracking-tight">acropolis</span>}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <ul className="flex-1 space-y-1 px-2">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {!collapsed && <span>{label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border px-3 py-3">
        <Link href="/inbox" className="flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground">
          <Bell className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && <span>Notifications</span>}
        </Link>
        {!collapsed && (
          <div className="mt-3 text-xs text-muted-foreground">
            <div className="truncate text-foreground">{memberName}</div>
            <div className="capitalize">{role}</div>
          </div>
        )}
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Create the app shell and wire the layout**

```tsx
// components/shell/app-shell.tsx
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { member as memberTable, member_context } from "@/lib/db/schema.generated";
import { resolveTheme } from "@/lib/theme/resolve";
import { tokenSetToCssVars } from "@/lib/theme/css";
import { LeftNav } from "./left-nav";
import { CoPilotDock } from "./co-pilot-dock";
import type { BuiltInRole } from "@/lib/auth/users";

interface Props {
  children: React.ReactNode;
  actor: { userId: string; role: BuiltInRole | null; email?: string } | null;
  modelName?: string;
}

export async function AppShell({ children, actor, modelName }: Props): Promise<React.ReactElement> {
  // Unauthenticated (signin/setup) — render bare, no shell chrome.
  if (!actor) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
  }

  const db = getDb();
  let memberName = actor.email ?? "Member";
  let role = "staff";
  let themePref: string | null = null;

  try {
    const rows = await db
      .select({ full_name: memberTable.full_name, tier_role: memberTable.tier_role })
      .from(memberTable)
      .where(eq(memberTable.id, actor.userId))
      .limit(1);
    if (rows.length > 0) {
      memberName = rows[0].full_name;
      role = rows[0].tier_role;
    }
    const ctx = await db
      .select({ theme_pref: member_context.theme_pref })
      .from(member_context)
      .where(eq(member_context.member_id, actor.userId))
      .limit(1);
    themePref = ctx[0]?.theme_pref ?? null;
  } catch {
    // tolerate — fall back to base theme + defaults
  }

  const tokens = resolveTheme({ memberPref: themePref, role, orgSeed: null });

  return (
    <div
      style={tokenSetToCssVars(tokens)}
      className="flex h-screen overflow-hidden bg-background text-foreground"
    >
      <LeftNav memberName={memberName} role={role} />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <CoPilotDock actorRole={actor.role} actorEmail={actor.email} modelName={modelName} />
    </div>
  );
}
```

Then in `app/layout.tsx`, replace the body so `<AppShell>` wraps children and hosts the dock (remove the standalone `<ChatPanel/>` mount):

```tsx
  return (
    <html lang="en">
      <body className="antialiased">
        <TopProgressBar />
        <AppShell actor={actor ?? null} modelName={modelName}>
          {children}
        </AppShell>
        <MutationPulseMount />
        <ReloadToast />
      </body>
    </html>
  );
```

Add `import { AppShell } from "@/components/shell/app-shell";` and build the `actor` object from the existing `createCtx(session)` result (it already yields `actor` with `userId`/`role`/`email`). Remove the old `pb-20 md:pb-24` body padding (no bottom strip now) and the `ChatPanel` import.

- [ ] **Step 5: Type-check, restart, verify visually**

Run: `docker exec acropolisos-app npx tsc --noEmit` → 0 errors.
Run: `docker restart acropolisos-app` (layout/route change).
Open http://localhost:3030, sign in. Verify: left nav present with working links + collapse toggle; dashboard center; chat docked right with collapse toggle; both collapse states persist across reload. (Page bodies still look zinc-ish — Task 7+ fixes that.)

- [ ] **Step 6: Commit**

```bash
git add components/shell app/layout.tsx components/chat-panel.tsx
git commit -m "feat(acropolisos): three-region app shell — collapsible nav + co-pilot dock + server theme emission"
```

---

## Task 7: Token migration — the dashboard (flagship)

> The migration mapping below is the canonical content; Tasks 7–9 apply it. No unit tests (CSS/visual). Gate = `tsc` + visual check.

**Canonical mapping (apply in every migration task):**

| Hardcoded class(es) | Replace with |
|---|---|
| `bg-zinc-950`, `bg-black`, `bg-zinc-900/…` (page bg) | `bg-background` |
| `bg-zinc-900`, `bg-zinc-900/30`, `bg-zinc-800` (surfaces/cards) | `bg-card` |
| `text-zinc-100`, `text-white`, `text-zinc-50` | `text-foreground` |
| `text-zinc-300/400` | `text-foreground` (body) or `text-muted-foreground` (secondary) |
| `text-zinc-500/600` | `text-muted-foreground` |
| `border-zinc-800`, `border-zinc-800/60`, `border-zinc-700` | `border-border` |
| `bg-zinc-100 text-zinc-900` (primary buttons) | `bg-primary text-primary-foreground` |
| `ring-zinc-800` / `focus:ring-zinc-600` | `ring-ring` |
| `bg-violet-500/400`, `text-violet-300`, accent dots | `bg-primary` / `text-primary` |
| `bg-red-950/40 text-red-300 ring-red-900` (errors) | `bg-destructive/15 text-destructive ring-destructive/40` |
| input bg `bg-zinc-900` | `bg-input` (or `bg-card`) |

**Files:**
- Modify: `app/page.tsx` (49 occurrences), `components/home/*` (any used by `/`)

- [ ] **Step 1: Migrate `app/page.tsx`** — apply the mapping table to every widget renderer (`MetricWidget`, `DataTableWidget`, `RosterWidget`, `CalendarWidget`, `WidgetCard`) and the page chrome. Remove the `min-h-screen bg-zinc-950` wrapper (the shell now owns bg/height); keep the `mx-auto max-w-3xl px-6 py-10` content container. Convert the 10px uppercase labels to readable sizes where appropriate (`text-xs` not `text-[10px]`).

- [ ] **Step 2: Migrate `components/home/*`** — apply the same mapping to any home components referenced by `/` (`empty-home`, `live-home`, `seeded-home`, `prompt-button`).

- [ ] **Step 3: Type-check**

Run: `docker exec acropolisos-app npx tsc --noEmit` → 0 errors.

- [ ] **Step 4: Visual verify**

Open http://localhost:3030. The dashboard should now read as a finished surface (consistent `bg-card` cards, `text-foreground` headings, primary-accented active states), with no harsh pure-black/zinc literals. Cross-check the co-pilot dock matches.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx components/home
git commit -m "refactor(acropolisos): migrate dashboard to semantic theme tokens"
```

---

## Task 8: Token migration — core flows (organize, connect, inbox, ontology)

**Files:**
- Modify: `app/organize/page.tsx`, `app/organize/proposal-review-list.tsx`, `app/connect/page.tsx`, `app/inbox/page.tsx`, `app/ontology/page.tsx`, `app/ontology-editor/page.tsx`

- [ ] **Step 1: Apply the Task-7 mapping table to each file.** Work one file at a time. For each, after editing, glance for remaining `zinc-`/`text-white`/`bg-black` with: `docker exec acropolisos-app sh -c "grep -n 'zinc-\|bg-black\|text-white\|bg-white' app/organize/page.tsx"` (repeat per file) — expect no matches.

- [ ] **Step 2: Type-check** → `docker exec acropolisos-app npx tsc --noEmit` → 0 errors.

- [ ] **Step 3: Visual verify** each route in the browser under the shell: `/organize`, `/connect`, `/inbox`, `/ontology`. Surfaces use `bg-card`, text uses foreground/muted, errors use destructive.

- [ ] **Step 4: Commit**

```bash
git add app/organize app/connect app/inbox app/ontology app/ontology-editor
git commit -m "refactor(acropolisos): migrate core flow pages to semantic tokens"
```

---

## Task 9: Token migration — remaining pages + chat panel internals

**Files:**
- Modify: `app/dashboard/ask/page.tsx`, `app/dashboard/ask/chat-client.tsx`, `app/chat/page.tsx`, `app/audit/page.tsx`, `app/proposals/page.tsx`, `app/proposals/[id]/reviewer.tsx`, `app/seed/page.tsx`, `app/seed/[bundle]/page.tsx`, `app/seed/[bundle]/[type]/page.tsx`, `app/me/page.tsx`, `app/setup/page.tsx`, `app/signin/page.tsx`, `app/(generated)/[type]/page.tsx`, `app/(generated)/[type]/[id]/page.tsx`, `components/chat-panel.tsx` (internal classes), `components/inline-proposal-panel.tsx`, `components/chat/action-confirmation-card.tsx`

- [ ] **Step 1: Apply the Task-7 mapping table to each file**, one at a time. The chat-panel internals carry the most literals (violet accents → `text-primary`/`bg-primary`; zinc surfaces → card/border; red errors → destructive). `signin`/`setup` render outside the shell, so they need their own `bg-background` wrapper retained.

- [ ] **Step 2: Sweep for stragglers**

Run: `docker exec acropolisos-app sh -c "grep -rln 'zinc-\|bg-black\|text-white\|bg-white' app components"`
Expected: no output (zero files). If any remain, migrate them.

- [ ] **Step 3: Type-check** → `docker exec acropolisos-app npx tsc --noEmit` → 0 errors.

- [ ] **Step 4: Visual verify** the remaining routes + the chat dock streaming state (agent pulse uses `text-primary`, error bubble uses destructive).

- [ ] **Step 5: Commit**

```bash
git add app components
git commit -m "refactor(acropolisos): complete semantic-token migration (chat panel + remaining pages)"
```

---

## Task 10: Final integration verification

- [ ] **Step 1: Full type-check** → `docker exec acropolisos-app npx tsc --noEmit` → 0 errors.

- [ ] **Step 2: Full unit suite** → `docker exec acropolisos-app npx vitest run lib/theme components/shell` → all PASS.

- [ ] **Step 3: Regression — the data path is untouched, prove it stayed green**

Run: `docker exec acropolisos-app sh -c 'npx tsx scripts/integration-proof.ts > /tmp/ip.out 2>&1; echo EXIT:$?; tail -6 /tmp/ip.out'`
Expected: EXIT:0, "All 7 steps passed."

- [ ] **Step 4: Confirm token system is the single source**

Run: `docker exec acropolisos-app sh -c "grep -rln 'zinc-\|bg-black\|text-white' app components"`
Expected: no output.

- [ ] **Step 5: Manual product walkthrough** — sign in; collapse/expand both panels (persists); navigate every nav route; drop a CSV in the dock → classify → confirm → see it on the dashboard, all under the new themed shell.

- [ ] **Step 6: Commit any final touch-ups**

```bash
git add -A
git commit -m "chore(acropolisos): UI rework core — final verification pass"
```

---

## Self-Review

**Spec coverage:** Shell/collapsible panels → Tasks 5,6. Co-pilot dock (reposition ChatPanel) → Task 6. Token migration (the unlock) → Tasks 7–9. Base palette + `TokenSet` + resolver + CSS emission (Tier-1 plumbing) → Tasks 1,2,4,6. `theme_pref` storage decision + ALTER → Task 3. Read-only fence preserved (theming reads member_context, writes nothing in this plan) → Task 6. Regression of untouched data path → Task 10. Deferred: theme switcher UI, `design_theme` agent, per-role/data-derived values, arrangement UI — explicitly Phase 4/5 (separate plans); the resolver/`roleDefault`/`seedToTokens` seams exist so callers don't change later.

**Placeholder scan:** none — every code step has complete code; migration mapping is concrete; commands have expected output.

**Type consistency:** `TokenSet`/`TOKEN_KEYS`/`BASE_TOKENS`/`isValidTokenSet`/`parseTokenSet` (Task 1) used identically in Tasks 2 & 4. `resolveTheme({memberPref,role,orgSeed})` signature (Task 2) called exactly so in Task 6. `tokenSetToCssVars` (Task 4) consumed in Task 6. `NAV_KEY`/`DOCK_KEY`/`readCollapsed`/`writeCollapsed` (Task 5) used in nav + dock (Task 6). `theme_pref` column (Task 3) read in Task 6.
