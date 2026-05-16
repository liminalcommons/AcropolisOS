import type { BuiltInRole } from "./users";

export interface AcropolisJwt {
  sub?: string;
  email?: string | null;
  role?: string;
  customRoles?: unknown;
  [key: string]: unknown;
}

export interface AcropolisUserSlice {
  userId: string;
  email: string;
  role: BuiltInRole;
  customRoles: string[];
}

interface MutableSession {
  user?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AuthorizedUserLike {
  id: string;
  email: string;
  role: BuiltInRole;
  customRoles: string[];
}

export function enrichJwt(
  token: AcropolisJwt,
  user: AuthorizedUserLike | undefined,
): AcropolisJwt {
  if (!user) return token;
  return {
    ...token,
    sub: user.id,
    email: user.email,
    role: user.role,
    customRoles: [...user.customRoles],
  };
}

export function enrichSession<S extends MutableSession>(
  session: S,
  token: AcropolisJwt,
  knownCustomRoles: ReadonlySet<string>,
): S {
  const rawCustomRoles = Array.isArray(token.customRoles)
    ? (token.customRoles.filter((r) => typeof r === "string") as string[])
    : [];
  const customRoles = rawCustomRoles.filter((r) => knownCustomRoles.has(r));
  const role: BuiltInRole = token.role === "steward" ? "steward" : "member";
  session.user = {
    ...(session.user ?? {}),
    userId: token.sub ?? "",
    email: token.email ?? "",
    role,
    customRoles,
  };
  return session;
}
