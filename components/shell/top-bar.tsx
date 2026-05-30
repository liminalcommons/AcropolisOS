"use client";

// The shell's thin top header — replaces the fixed 7-tab left rail. The board
// IS the navigation (its widget cards link to /[type] collections + details);
// the chat dock is the command/compose/ingest surface. This header carries only
// the irreducible kernel: org identity (→ home board), the two non-data places
// (the model + the assimilation queue), a steward "view as" role switch (the
// storyboard's role tabs), and utilities. No feature tabs.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { ThemeSwitcher } from "./theme-switcher";
import { signOutAction } from "@/lib/auth/sign-out-action";

// Ontology-derived "view as" switch (steward-only). Selecting a role re-derives
// the home board through that role's permission lens (?as=<role>) — the same
// render function, a different viewer. "your board" is the steward's own view.
function RoleSwitch({ roles }: { roles: string[] }) {
  const router = useRouter();
  return (
    <label className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="opacity-70">view as</span>
      <select
        defaultValue="steward"
        onChange={(e) => {
          const r = e.target.value;
          router.push(r === "steward" ? "/" : `/?as=${encodeURIComponent(r)}`);
        }}
        aria-label="View the board as a role"
        className="rounded border border-border bg-input px-1.5 py-1 text-xs text-foreground focus:outline-none focus:border-ring"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {r === "steward" ? "your board" : r}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TopBar({
  memberName,
  role,
  orgName,
  roles = [],
  canSwitch = false,
}: {
  memberName: string;
  role: string;
  orgName: string;
  roles?: string[];
  canSwitch?: boolean;
}): React.ReactElement {
  return (
    <header className="flex items-center gap-3 shrink-0 border-b border-border bg-card/60 px-4 py-2.5 text-card-foreground">
      <Link href="/" className="flex items-center gap-2 min-w-0 shrink-0">
        <span className="text-lg font-bold text-foreground">◆</span>
        <span
          className="font-semibold tracking-tight truncate max-w-[30vw]"
          title={orgName}
        >
          {orgName}
        </span>
      </Link>

      {/* The two non-data kernel places. Everything else is composed onto the
          board (the navigation) or asked for in chat. */}
      <nav className="hidden sm:flex items-center gap-0.5 text-sm ml-2" aria-label="Places">
        <Link
          href="/ontology"
          className="rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Ontology
        </Link>
        <Link
          href="/organize"
          className="rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Organize
        </Link>
        {canSwitch && (
          <Link
            href="/veto-queue"
            className="rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Decisions
          </Link>
        )}
      </nav>

      <div className="ml-auto flex items-center gap-3 shrink-0">
        {canSwitch && roles.length > 1 ? <RoleSwitch roles={roles} /> : null}
        <Link
          href="/inbox"
          aria-label="Notifications"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <Bell className="h-4 w-4" />
        </Link>
        <ThemeSwitcher />
        <div className="flex items-center gap-2 pl-1">
          <div className="hidden md:block text-right leading-tight">
            <div className="text-xs text-foreground truncate max-w-[140px]">{memberName}</div>
            <div className="text-[10px] capitalize text-muted-foreground">{role}</div>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
