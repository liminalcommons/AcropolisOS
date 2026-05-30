"use client";

// The shell's thin top header — replaces the fixed 7-tab left rail. The board
// IS the navigation (its widget cards link to /[type] collections + details);
// the chat dock is the command/compose/ingest surface. This header carries only
// the irreducible kernel: org identity (→ home board), the two non-data places
// (the model + the assimilation queue), and utilities. No feature tabs.

import Link from "next/link";
import { Bell } from "lucide-react";
import { ThemeSwitcher } from "./theme-switcher";
import { signOutAction } from "@/lib/auth/sign-out-action";

export function TopBar({
  memberName,
  role,
  orgName,
}: {
  memberName: string;
  role: string;
  orgName: string;
}): React.ReactElement {
  return (
    <header className="flex items-center gap-3 shrink-0 border-b border-border bg-card/60 px-4 py-2.5 text-card-foreground">
      <Link href="/" className="flex items-center gap-2 min-w-0 shrink-0">
        <span className="text-lg font-bold text-foreground">◆</span>
        <span
          className="font-semibold tracking-tight truncate max-w-[36vw]"
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
      </nav>

      <div className="ml-auto flex items-center gap-3 shrink-0">
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
