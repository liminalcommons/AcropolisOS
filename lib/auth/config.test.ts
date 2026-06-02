import { describe, expect, it, vi } from "vitest";
import { buildAuthConfig } from "./config";
import type { UserStore } from "./users";

function fakeStore(): UserStore {
  return {
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    authorize: vi
      .fn()
      .mockImplementation(async (email: string, password: string) => {
        if (email === "alice@example.com" && password === "ok") {
          return {
            id: "u-1",
            email: "alice@example.com",
            role: "steward",
            customRoles: ["finance"],
          };
        }
        return null;
      }),
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

function credentialsProvider(config: ReturnType<typeof buildAuthConfig>) {
  const provider = (config.providers ?? [])[0] as unknown as
    | CredentialsProvider
    | (() => CredentialsProvider);
  const resolved =
    typeof provider === "function" ? provider() : provider;
  return resolved;
}

function authorizeFn(cp: CredentialsProvider) {
  return cp.options.authorize;
}

describe("buildAuthConfig", () => {
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

  it("exposes a credentials provider that calls store.authorize", async () => {
    const cfg = buildAuthConfig({
      userStore: fakeStore(),
      loadKnownCustomRoles: async () => new Set(["finance"]),
    });
    const cp = credentialsProvider(cfg);
    expect(cp.id ?? cp.type).toMatch(/credentials/i);
    const authorize = authorizeFn(cp);

    const ok = await authorize({
      email: "alice@example.com",
      password: "ok",
    });
    expect(ok).toMatchObject({
      id: "u-1",
      email: "alice@example.com",
      role: "steward",
      customRoles: ["finance"],
    });

    const bad = await authorize({
      email: "alice@example.com",
      password: "wrong",
    });
    expect(bad).toBeNull();
  });

  it("returns null from authorize when credentials are missing", async () => {
    const cfg = buildAuthConfig({
      userStore: fakeStore(),
      loadKnownCustomRoles: async () => new Set(),
    });
    const authorize = authorizeFn(credentialsProvider(cfg));
    expect(await authorize({})).toBeNull();
    expect(await authorize({ email: "x@y", password: "" })).toBeNull();
  });

  it("authorize accepts a valid magicToken and returns the linked user", async () => {
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
    expect(ok).toMatchObject({
      id: "u-9",
      email: "steward@acropolisos.local",
      role: "steward",
      customRoles: ["finance"],
    });
  });

  it("authorize rejects an invalid/expired/used magicToken", async () => {
    const magicLinkStore = { consume: vi.fn().mockResolvedValue(null) };
    const cfg = buildAuthConfig({
      userStore: fakeStore(),
      magicLinkStore,
      loadKnownCustomRoles: async () => new Set(),
    });
    const authorize = authorizeFn(credentialsProvider(cfg));
    expect(await authorize({ magicToken: "bad" })).toBeNull();
  });

  it("authorize rejects a magicToken whose user no longer exists", async () => {
    // fakeStore().findByEmail resolves null -> consumed token maps to nobody.
    const magicLinkStore = {
      consume: vi.fn().mockResolvedValue("ghost@example.com"),
    };
    const cfg = buildAuthConfig({
      userStore: fakeStore(),
      magicLinkStore,
      loadKnownCustomRoles: async () => new Set(),
    });
    const authorize = authorizeFn(credentialsProvider(cfg));
    expect(await authorize({ magicToken: "orphan" })).toBeNull();
  });

  it("jwt callback merges authorized user fields into the token", async () => {
    const cfg = buildAuthConfig({
      userStore: fakeStore(),
      loadKnownCustomRoles: async () => new Set(["finance"]),
    });
    const jwt = cfg.callbacks!.jwt!;
    const token = await jwt({
      token: {},
      user: {
        id: "u-1",
        email: "alice@example.com",
        role: "steward",
        customRoles: ["finance", "ignored-elsewhere"],
      },
    } as never);
    expect(token).toMatchObject({
      sub: "u-1",
      email: "alice@example.com",
      role: "steward",
      customRoles: ["finance", "ignored-elsewhere"],
    });
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
