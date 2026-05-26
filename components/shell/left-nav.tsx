"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home, CalendarDays, Inbox, Plug, Network, Users, Bell,
  PanelLeftClose, PanelLeftOpen, Workflow, LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_KEY, readCollapsed, writeCollapsed } from "./shell-state";
import { ThemeSwitcher } from "./theme-switcher";

const ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/day", label: "Today", icon: CalendarDays },
  { href: "/org", label: "Org", icon: LayoutDashboard },
  { href: "/organize", label: "Organize", icon: Inbox },
  { href: "/connect", label: "Connect", icon: Plug },
  { href: "/ontology", label: "Ontology", icon: Network },
  { href: "/graph", label: "Graph", icon: Workflow },
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
        {!collapsed && <ThemeSwitcher />}
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
