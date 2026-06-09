import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthConfig } from "./config";
import type { UserStore } from "./users";

function fakeStore(): UserStore {
  return {
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    authorize: vi.fn().mockResolvedValue(null),
    deleteById: vi.fn().mockResolvedValue(true),
    countStewards: vi.fn().mockResolvedValue(1),
  };
}

interface CredentialsProvider {
  id: string;
  type: string;
  options: {
    authorize: (
      creds: Record<string, unknown> | undefined,
    ) => Promise<unknown | null>;
  };
}

function resolveProvider(p: unknown): CredentialsProvider {
  return (typeof p === "function" ? (p as () => CredentialsProvider)() : p) as CredentialsProvider;
}

/** The magic-link credentials provider is always first. */
function credentialsProvider(config: ReturnType<typeof buildAuthConfig>) {
  return resolveProvider((config.providers ?? [])[0]);
}

function authorizeFn(cp: CredentialsProvider) {
  return cp.options.authorize;
}

describe("buildAuthConfig", () => {
  afterEach(() => {
    delete process.env.LOGTO_ISSUER;
    delete process.env.LOGTO_CLIENT_ID;
    delete process.env.LOGTO_CLIENT_SECRET;
    delete process.env.STEWARD_EMAILS;
  });

  it("uses JWT session strategy", () => {
    const cfg = buildAuthConfig({
      userStore: fakeStore(),
      loadKnownCustomRoles: async () => new Set(["finance"]),
    });
    expect(cfg.session?.strategy).toBe("jwt");
  });

  it("registers /signin as the sign-in page", () => {
    const cfg = buildAuthConfig({
      userStore: fakeStore(),
      loadKnownCustomRoles: async () => new Set(),
    });
    expect(cfg.pages?.signIn).toBe("/signin");
  });

  it("the first provider is the magic-link credentials door (no password field)", () => {
    const cfg = buildAuthConfig({ userStore: fakeStore() });
    const cp = credentialsProvider(cfg);
    expect(cp.id ?? cp.type).toMatch(/credentials/i);
  });

  it("authorize returns null without a magicToken (the password door is gone)", async () => {
    const cfg = buildAuthConfig({ userStore: fakeStore() });
    const authorize = authorizeFn(credentialsProvider(cfg));
    expect(await authorize({})).toBeNull();
    expect(await authorize({ email: "x@y", password: "anything" })).toBeNull();
  });

  it("authorize accepts a valid magicToken and returns the linked user (role-free)", async () => {
    const userStore = fakeStore();
    userStore.findByEmail = vi.fn().mockResolvedValue({
      id: "u-9",
      email: "steward@acropolisos.local",
      passwordHash: "irrelevant",
      role: "steward",
      customRoles: ["finance"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const magicLinkStore = {
      consume: vi.fn().mockResolvedValue("steward@acropolisos.local"),
    };
    const cfg = buildAuthConfig({
      userStore,
      magicLinkStore,
      loadKnownCustomRoles: async () => new Set(["finance"]),
    });
    const authorize = authorizeFn(credentialsProvider(cfg));

    const ok = await authorize({ magicToken: "good-token" });
    expect(magicLinkStore.consume).toHaveBeenCalledWith("good-token");
    // Role is NOT decided here anymore — STEWARD_EMAILS drives it in jwt().
    expect(ok).toMatchObject({
      id: "u-9",
      email: "steward@acropolisos.local",
      customRoles: ["finance"],
    });
  });

  it("authorize rejects an invalid/expired/used magicToken", async () => {
    const magicLinkStore = { consume: vi.fn().mockResolvedValue(null) };
    const cfg = buildAuthConfig({
      userStore: fakeStore(),
      magicLinkStore,
    });
    const authorize = authorizeFn(credentialsProvider(cfg));
    expect(await authorize({ magicToken: "bad" })).toBeNull();
  });

  it("authorize rejects a magicToken whose user no longer exists", async () => {
    const magicLinkStore = {
      consume: vi.fn().mockResolvedValue("ghost@example.com"),
    };
    const cfg = buildAuthConfig({
      userStore: fakeStore(), // findByEmail -> null
      magicLinkStore,
    });
    const authorize = authorizeFn(credentialsProvider(cfg));
    expect(await authorize({ magicToken: "orphan" })).toBeNull();
  });

  // ── Logto SSO provider (env-gated) ───────────────────────────────────────

  it("omits the Logto provider when its env trio is unset (magic-link only)", () => {
    const cfg = buildAuthConfig({ userStore: fakeStore() });
    expect(cfg.providers).toHaveLength(1);
  });

  it("adds the Logto OIDC provider with ES384 + email scope when configured", () => {
    process.env.LOGTO_ISSUER = "https://id.castalia.one/oidc";
    process.env.LOGTO_CLIENT_ID = "acropolisos-app";
    process.env.LOGTO_CLIENT_SECRET = "shh";
    const cfg = buildAuthConfig({ userStore: fakeStore() });
    expect(cfg.providers).toHaveLength(2);
    const logto = resolveProvider((cfg.providers ?? [])[1]) as unknown as {
      id: string;
      type: string;
      authorization?: { params?: { scope?: string } };
      // Built-in providers stash caller overrides under `.options`.
      options?: { client?: { id_token_signed_response_alg?: string } };
    };
    expect(logto.id).toBe("logto");
    expect(logto.type).toBe("oidc");
    expect(logto.options?.client?.id_token_signed_response_alg).toBe("ES384");
    expect(logto.authorization?.params?.scope).toContain("email");
  });

  // ── role mapping via STEWARD_EMAILS ──────────────────────────────────────

  it("jwt callback marks a STEWARD_EMAILS-listed email as steward", async () => {
    const cfg = buildAuthConfig({
      userStore: fakeStore(),
      stewardEmails: () => new Set(["alice@example.com"]),
      loadKnownCustomRoles: async () => new Set(["finance"]),
    });
    const jwt = cfg.callbacks!.jwt!;
    const token = await jwt({
      token: {},
      user: {
        id: "u-1",
        email: "Alice@Example.com",
        customRoles: ["finance", "ignored-elsewhere"],
      },
    } as never);
    expect(token).toMatchObject({
      sub: "u-1",
      email: "Alice@Example.com",
      role: "steward",
      customRoles: ["finance", "ignored-elsewhere"],
    });
  });

  it("jwt callback marks an unlisted email as member", async () => {
    const cfg = buildAuthConfig({
      userStore: fakeStore(),
      stewardEmails: () => new Set(["someone@else.com"]),
    });
    const jwt = cfg.callbacks!.jwt!;
    const token = await jwt({
      token: {},
      user: { id: "u-2", email: "rando@example.com" },
    } as never);
    expect(token).toMatchObject({ sub: "u-2", role: "member" });
  });

  it("session callback projects token onto session.user and filters customRoles", async () => {
    const cfg = buildAuthConfig({
      userStore: fakeStore(),
      loadKnownCustomRoles: async () => new Set(["finance"]),
    });
    const sessionCb = cfg.callbacks!.session!;
    const session = await sessionCb({
      session: { user: {} },
      token: {
        sub: "u-1",
        email: "alice@example.com",
        role: "steward",
        customRoles: ["finance", "not-in-yaml"],
      },
    } as never);
    expect((session as { user?: unknown }).user).toMatchObject({
      userId: "u-1",
      email: "alice@example.com",
      role: "steward",
      customRoles: ["finance"],
    });
  });
});
