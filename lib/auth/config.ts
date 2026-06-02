import path from "node:path";
import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";
import { loadCustomRoleNames } from "../ontology/roles";
import { FileUserStore, type UserStore } from "./users";
import {
  FileMagicLinkStore,
  defaultMagicLinkFile,
  type MagicLinkStore,
} from "./magic-link";
import { enrichJwt, enrichSession } from "./session-shape";

// See lib/setup/paths.ts for why we use process.cwd() instead of __dirname.
const PKG_ROOT = process.env.ACROPOLISOS_PKG_ROOT ?? process.cwd();
const DEFAULT_DATA_DIR = path.join(PKG_ROOT, "data");
const DEFAULT_USERS_FILE = path.join(DEFAULT_DATA_DIR, "users.json");
const DEFAULT_ONTOLOGY_DIR = path.join(
  PKG_ROOT,
  "scenarios",
  "small-community",
  "ontology",
);

export interface BuildAuthConfigOptions {
  userStore?: UserStore;
  magicLinkStore?: MagicLinkStore;
  loadKnownCustomRoles?: () => Promise<Set<string>>;
}

export function getUsersFile(): string {
  return process.env.ACROPOLISOS_USERS_FILE ?? DEFAULT_USERS_FILE;
}

export function getOntologyDir(): string {
  return process.env.ACROPOLISOS_ONTOLOGY_DIR ?? DEFAULT_ONTOLOGY_DIR;
}

export function buildAuthConfig(
  opts: BuildAuthConfigOptions = {},
): NextAuthConfig {
  const store: UserStore = opts.userStore ?? new FileUserStore(getUsersFile());
  const magic: MagicLinkStore =
    opts.magicLinkStore ?? new FileMagicLinkStore(defaultMagicLinkFile());
  const loadRoles =
    opts.loadKnownCustomRoles ??
    (async () => new Set(await loadCustomRoleNames(getOntologyDir())));

  return {
    session: { strategy: "jwt" },
    pages: {
      signIn: "/signin",
    },
    providers: [
      Credentials({
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        authorize: async (raw) => {
          // Passwordless path: a one-time magic link carries `magicToken`
          // instead of email/password. Consuming it yields the email it was
          // minted for; we then load that user (no password check — the
          // unguessable single-use token IS the proof). Falls through to the
          // password path when no token is present. `magicToken` isn't part of
          // the declared `credentials` shape, so read it off a widened view.
          const extra = (raw ?? {}) as Record<string, unknown>;
          const magicToken =
            typeof extra.magicToken === "string" && extra.magicToken.length > 0
              ? extra.magicToken
              : undefined;
          if (magicToken) {
            const email = await magic.consume(magicToken);
            if (!email) return null;
            const user = await store.findByEmail(email);
            if (!user) return null;
            return {
              id: user.id,
              email: user.email,
              role: user.role,
              customRoles: [...user.customRoles],
            };
          }

          const email =
            typeof raw?.email === "string" ? raw.email.trim() : undefined;
          const password =
            typeof raw?.password === "string" ? raw.password : undefined;
          if (!email || !password) return null;
          const user = await store.authorize(email, password);
          if (!user) return null;
          return {
            id: user.id,
            email: user.email,
            role: user.role,
            customRoles: user.customRoles,
          };
        },
      }),
    ],
    callbacks: {
      jwt: ({ token, user }) => {
        if (!user) return token;
        return enrichJwt(token, {
          id: String(user.id),
          email: String(user.email ?? ""),
          role:
            (user as { role?: string }).role === "steward"
              ? "steward"
              : "member",
          customRoles: Array.isArray(
            (user as { customRoles?: unknown }).customRoles,
          )
            ? ((user as { customRoles: unknown[] }).customRoles.filter(
                (r) => typeof r === "string",
              ) as string[])
            : [],
        });
      },
      session: async ({ session, token }) => {
        const known = await loadRoles();
        enrichSession(
          session as unknown as { user?: Record<string, unknown> },
          token,
          known,
        );
        return session;
      },
    },
  };
}
