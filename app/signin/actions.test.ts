import { describe, expect, it, vi, beforeEach } from "vitest";

// The /signin Logto door must go through Auth.js's server-side signIn()
// (which manages CSRF internally) — NOT a hand-rolled <form> POST to
// /api/auth/signin/logto carrying a cookie-scraped csrfToken. That form
// fails with MissingCSRF for any browser that has never hit an
// /api/auth GET endpoint (fresh visitors), because nothing on /signin
// ever SETS the csrf cookie it tries to read.
const signIn = vi.fn();
vi.mock("@/lib/auth", () => ({ signIn: (...args: unknown[]) => signIn(...args) }));

import { signInWithLogto } from "./actions";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("signInWithLogto server action", () => {
  beforeEach(() => signIn.mockReset());

  it("delegates to Auth.js signIn with the logto provider and callbackUrl", async () => {
    await signInWithLogto(form({ callbackUrl: "/decisions" }));
    expect(signIn).toHaveBeenCalledWith("logto", { redirectTo: "/decisions" });
  });

  it("defaults the redirect to /chat when no callbackUrl is posted", async () => {
    await signInWithLogto(form({}));
    expect(signIn).toHaveBeenCalledWith("logto", { redirectTo: "/chat" });
  });

  it("refuses absolute/external callback URLs (open-redirect guard)", async () => {
    await signInWithLogto(form({ callbackUrl: "https://evil.example.com/x" }));
    expect(signIn).toHaveBeenCalledWith("logto", { redirectTo: "/chat" });
  });
});
