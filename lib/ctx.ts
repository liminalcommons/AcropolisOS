import type { AcropolisUserSlice } from "./auth/session-shape";
import type { BuiltInRole } from "./auth/users";

export interface AcropolisSession {
  user?: Partial<AcropolisUserSlice> & Record<string, unknown>;
}

export interface Actor {
  userId: string;
  email: string;
  role: BuiltInRole;
  customRoles: string[];
}

export interface Ctx {
  actor: Actor | null;
}

export function createCtx(session: AcropolisSession | null): Ctx {
  if (!session || !session.user || !session.user.userId) {
    return { actor: null };
  }
  const u = session.user;
  return {
    actor: {
      userId: String(u.userId),
      email: String(u.email ?? ""),
      role: u.role === "steward" ? "steward" : "member",
      customRoles: Array.isArray(u.customRoles) ? [...u.customRoles] : [],
    },
  };
}
