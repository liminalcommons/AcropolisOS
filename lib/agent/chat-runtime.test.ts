// M3.8 step-1: chat-runtime must NOT silently elevate unauthenticated
// requests to the steward sentinel.
//
// Previously, when `auth()` returned null (no session cookie), buildChatRuntime
// fell back to:
//   { userId: "steward-local", role: "steward", ... }
// which gave anonymous callers steward-level apply_action access through
// /api/chat, plus inheritance into /inbox (#37) and the /inbox server
// actions (#38). This is a complete privilege bypass — see #33.
//
// Fix policy: keep a sentinel actor (the /setup wizard, /signin, /claim all
// transit chat-runtime), but make it ZERO-permission. New role: "anonymous".
// Routes that need auth check `isAnonymous(runtime.actor)` and reject.

import { describe, expect, it, vi } from "vitest";

// Stub the auth module to control session presence per test.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

// Avoid touching the disk-based ontology loader / Postgres in this unit test.
vi.mock("@/lib/ontology/load", () => ({
  loadOntology: async () => ({
    object_types: {},
    link_types: {},
    property_types: {},
    action_types: {},
    roles: {},
    ingest_mappings: {},
  }),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({}),
}));

vi.mock("@/lib/ontology/ctx-runtime", () => ({
  createOntologyCtxForActor: (input: { actor: unknown }) => ({
    actor: input.actor,
    db: {},
  }),
}));

import { auth } from "@/lib/auth";
import { buildChatRuntime, isAnonymous } from "./chat-runtime";

describe("buildChatRuntime — anonymous sentinel (M3.8 #33)", () => {
  it("returns a zero-permission anonymous actor when auth() returns null", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const runtime = await buildChatRuntime();

    // The fix: NO steward fallback. Role is the new sentinel "anonymous".
    expect(runtime.actor).not.toBeNull();
    expect(runtime.actor?.role).toBe("anonymous");
    expect(runtime.actor?.role).not.toBe("steward");
    expect(runtime.actor?.customRoles).toEqual([]);
    // isAnonymous helper recognises the sentinel.
    expect(isAnonymous(runtime.actor)).toBe(true);
  });

  it("returns the authenticated actor when auth() resolves a session", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: {
        userId: "u-1",
        email: "u@example.com",
        role: "member",
      },
    });

    const runtime = await buildChatRuntime();

    expect(runtime.actor?.userId).toBe("u-1");
    expect(runtime.actor?.role).toBe("member");
    expect(isAnonymous(runtime.actor)).toBe(false);
  });

  it("preserves steward role for an authenticated steward", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: {
        userId: "s-1",
        email: "s@example.com",
        role: "steward",
      },
    });

    const runtime = await buildChatRuntime();

    expect(runtime.actor?.role).toBe("steward");
    expect(isAnonymous(runtime.actor)).toBe(false);
  });
});

describe("isAnonymous helper", () => {
  it("returns true for null actor (defense in depth)", () => {
    expect(isAnonymous(null)).toBe(true);
  });

  it("returns false for a member actor", () => {
    expect(
      isAnonymous({
        userId: "x",
        email: "x@y",
        role: "member",
        customRoles: [],
      }),
    ).toBe(false);
  });

  it("returns false for a steward actor", () => {
    expect(
      isAnonymous({
        userId: "x",
        email: "x@y",
        role: "steward",
        customRoles: [],
      }),
    ).toBe(false);
  });
});
