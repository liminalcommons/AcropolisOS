import path from "node:path";
import Credentials from "next-auth/providers/credentials";
import Logto from "next-auth/providers/logto";
import type { NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import { loadCustomRoleNames } from "../ontology/roles";
import { FileUserStore, type UserStore } from "./users";
import {
  FileMagicLinkStore,
  defaultMagicLinkFile,
  type MagicLinkStore,
} from "./magic-link";
import { enrichJwt, enrichSession } from "./session-shape";
import { parseStewardEmails, resolveRole } from "./steward";

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
  /** Injected steward allow-list (defaults to parsing STEWARD_EMAILS). */
  stewardEmails?: () => Set<string>;
}

/**
 * The Logto OIDC provider — the PRIMARY, user-facing sign-in door (shared
 * ecosystem identity at id.castalia.one). Returns null when its env trio is
 * unset so a pre-credential deploy still boots and serves /signin via the
 * magic-link break-glass (NOT a backward-compat shim: it's config-presence
 * gating of an optional integration). GOTCHA: Logto signs ID tokens with ES384,
 * not the OIDC default RS256 — without the explicit alg the callback fails with
 * a signature error (this exact bug stranded the calendar for a week). Issuer
 * discovery resolves the JWKS; the alg override pins verification to ES384.
 */
function logtoProvider(): Provider | null {
  const issuer = process.env.LOGTO_ISSUER;
  const clientId = process.env.LOGTO_CLIENT_ID;
  const clientSecret = process.env.LOGTO_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) return null;
  return Logto({
    issuer,
    clientId,
    clientSecret,
    authorization: { params: { scope: "openid offline_access profile email" } },
    client: { id_token_signed_response_alg: "ES384" },
  });
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
  const stewardEmails =
    opts.stewardEmails ??
    (() => parseStewardEmails(process.env.STEWARD_EMAILS));

  // Magic link is the OPERATOR break-glass / verification channel: it carries a
  // single-use `magicToken` (minted offline by scripts/mint-magic-link.ts, never
  // web-reachable) instead of a password. Consuming it yields the email it was
  // minted for; we load that user to confirm it exists (the unguessable token IS
  // the proof — no password). The password door is GONE: Logto is the door.
  const credentials = Credentials({
    credentials: { email: { label: "Email", type: "email" } },
    authorize: async (raw) => {
      const extra = (raw ?? {}) as Record<string, unknown>;
      const magicToken =
        typeof extra.magicToken === "string" && extra.magicToken.length > 0
          ? extra.magicToken
          : undefined;
      if (!magicToken) return null;
      const email = await magic.consume(magicToken);
      if (!email) return null;
      const user = await store.findByEmail(email);
      if (!user) return null;
      return {
        id: user.id,
        email: user.email,
        customRoles: [...user.customRoles],
      };
    },
  });

  const providers: Provider[] = [credentials];
  const logto = logtoProvider();
  if (logto) providers.push(logto);

  return {
    session: { strategy: "jwt" },
    pages: {
      signIn: "/signin",
    },
    providers,
    callbacks: {
      jwt: ({ token, user }) => {
        if (!user) return token;
        // STEWARD_EMAILS is the single source of steward truth for BOTH doors
        // (Logto SSO + magic-link break-glass): Logto users carry no local role,
        // so the role is derived from the authenticated email alone.
        const email = String(user.email ?? "");
        return enrichJwt(token, {
          id: String(user.id),
          email,
          role: resolveRole(email, stewardEmails()),
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
