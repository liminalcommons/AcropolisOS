// auto_login — POST /api/setup/steward must establish a session for the
// FRESHLY-CREATED first steward (when stewardCount was 0), so the wizard can
// proceed without a separate manual sign-in.
//
// Security invariant guarded here: a session is established ONLY on the success
// path that just created the first steward. The 409 (steward already exists),
// the "setup already complete" 409, and every validation 400 must NOT call the
// session-establishing path — there is no anonymous bypass.
//
// Mechanism: the route mints a single-use magic link for the new steward's
// email and feeds it to next-auth signIn("credentials", { magicToken,
// redirect: false }), which runs the credentials authorize() and sets the
// session cookie via the Next cookies() store. We assert the route invoked that
// path with the new steward's token (the auth proof), since the Set-Cookie is
// written to the cookies() store, not the Response object we build by hand.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mutable mock state, reset per test ──────────────────────────────────────
let setupComplete = false;
let existingStewards = 0;
const createdUsers: Array<{ email: string }> = [];
const mintedLinks: Array<{ email: string; token: string }> = [];
const signInCalls: Array<{ provider: string; options: Record<string, unknown> }> =
  [];

vi.mock("@/lib/setup/state", () => ({
  isSetupComplete: async () => setupComplete,
}));
vi.mock("@/lib/setup/config", () => ({ getSetupFile: () => "/tmp/setup.json" }));
vi.mock("@/lib/auth/config", () => ({ getUsersFile: () => "/tmp/users.json" }));

vi.mock("@/lib/auth/users", () => ({
  FileUserStore: class {
    async countStewards() {
      return existingStewards;
    }
    async create(input: { email: string; role: string }) {
      const user = { id: "u-new", email: input.email, role: input.role };
      createdUsers.push({ email: input.email });
      existingStewards += 1;
      return user;
    }
  },
}));

vi.mock("@/lib/auth/magic-link", () => ({
  mintMagicLink: async (opts: { email: string }) => {
    const token = `tok-for-${opts.email}`;
    mintedLinks.push({ email: opts.email, token });
    return { token, url: `http://x/api/magic?token=${token}`, expiresAt: "z" };
  },
  defaultMagicLinkFile: () => "/tmp/magic.json",
}));

vi.mock("@/lib/auth", () => ({
  signIn: async (provider: string, options: Record<string, unknown>) => {
    signInCalls.push({ provider, options });
    return "/"; // redirect:false → returns the redirect URL, no throw
  },
}));

import { POST } from "./route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/setup/steward", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  setupComplete = false;
  existingStewards = 0;
  createdUsers.length = 0;
  mintedLinks.length = 0;
  signInCalls.length = 0;
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/setup/steward — auto-login on first steward", () => {
  it("creates the steward and establishes a session for that steward", async () => {
    const res = await POST(
      post({ email: "s@org.coop", password: "supersecret" }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { email: string; role: string };
    expect(json.email).toBe("s@org.coop");
    expect(json.role).toBe("steward");

    // session established via signIn with the freshly-minted magic token
    expect(signInCalls).toHaveLength(1);
    expect(signInCalls[0].provider).toBe("credentials");
    expect(signInCalls[0].options.redirect).toBe(false);
    expect(mintedLinks).toEqual([
      { email: "s@org.coop", token: "tok-for-s@org.coop" },
    ]);
    expect(signInCalls[0].options.magicToken).toBe("tok-for-s@org.coop");
  });

  it("does NOT establish a session when a steward already exists (409)", async () => {
    existingStewards = 1;
    const res = await POST(
      post({ email: "s2@org.coop", password: "supersecret" }),
    );
    expect(res.status).toBe(409);
    expect(createdUsers).toHaveLength(0);
    expect(signInCalls).toHaveLength(0);
  });

  it("does NOT establish a session when setup is already complete (409)", async () => {
    setupComplete = true;
    const res = await POST(
      post({ email: "s@org.coop", password: "supersecret" }),
    );
    expect(res.status).toBe(409);
    expect(signInCalls).toHaveLength(0);
  });

  it("does NOT establish a session on a validation failure (400)", async () => {
    const res = await POST(post({ email: "not-an-email", password: "x" }));
    expect(res.status).toBe(400);
    expect(createdUsers).toHaveLength(0);
    expect(signInCalls).toHaveLength(0);
  });
});
