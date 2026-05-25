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
