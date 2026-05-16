export interface RouteDecisionInput {
  authenticated: boolean;
  setupComplete: boolean;
  pathname: string;
}

export type RouteDecision =
  | { type: "next" }
  | { type: "redirect"; to: "/setup" | "/signin" };

const PUBLIC_PREFIXES = ["/api/", "/_next/", "/favicon.ico"];

export function nextRouteForAuth(input: RouteDecisionInput): RouteDecision {
  const { authenticated, setupComplete, pathname } = input;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return { type: "next" };
  }

  if (authenticated) return { type: "next" };

  if (!setupComplete) {
    return pathname === "/setup"
      ? { type: "next" }
      : { type: "redirect", to: "/setup" };
  }

  return pathname === "/signin"
    ? { type: "next" }
    : { type: "redirect", to: "/signin" };
}
