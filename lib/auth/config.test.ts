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
