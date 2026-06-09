// app/api/channels/bindings/route.test.ts
//
// The bindings management API is STEWARD-GATED (mirrors app/api/organize/grow):
//   - anonymous  -> 401 { error: "unauthorized" } BEFORE any db/store touch
//   - member     -> 403 { error: "forbidden" }     BEFORE any db/store touch
//   - bad POST action -> 400 { error: "bad_request" }
//   - happy bind -> persists via bindTarget (store called once)
//
// It reads raw_inbox (discovery) + channel_bindings ONLY — never the ontology
// ctx, never auth. Heavy deps (chat-runtime/db/discovery/store) are mocked so the
// route imports cleanly in a pure vitest environment.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── spies hoisted above the vi.mock factories (vitest hoists vi.mock) ───────────
const h = vi.hoisted(() => ({
  // auth: ACTOR is swapped per-suite below.
  ACTOR: { userId: "anonymous", email: "", role: "anonymous", customRoles: [] as string[] },
  discoverChannels: vi.fn(async (_db: unknown) => ({ telegram: [], discord: [] })),
  listBindings: vi.fn(async (_db: unknown) => [] as unknown[]),
  bindTarget: vi.fn(async (_db: unknown, _target: Record<string, unknown>) => undefined),
  ignoreTarget: vi.fn(async (_db: unknown, _key: Record<string, unknown>) => undefined),
  setEnabled: vi.fn(async (_db: unknown, _key: Record<string, unknown>, _enabled: boolean) => undefined),
  relabel: vi.fn(async (_db: unknown, _key: Record<string, unknown>, _label: string) => undefined),
  mergeDiscoveryWithBindings: vi.fn((_d: unknown, _b: unknown, _o: unknown) => [] as unknown[]),
}));
const {
  discoverChannels,
  listBindings,
  bindTarget,
  ignoreTarget,
  setEnabled,
  relabel,
  mergeDiscoveryWithBindings,
} = h;

vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: async () => ({ actor: h.ACTOR }),
  isAnonymous: (actor: { role?: string } | null) =>
    actor === null || actor.role === "anonymous",
}));

// ── db + read/write layers (steward path only) ────────────────────────────────
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/channels/discovery", () => ({ discoverChannels: h.discoverChannels }));
vi.mock("@/lib/channels/bindings", () => ({
  listBindings: h.listBindings,
  bindTarget: h.bindTarget,
  ignoreTarget: h.ignoreTarget,
  setEnabled: h.setEnabled,
  relabel: h.relabel,
  mergeDiscoveryWithBindings: h.mergeDiscoveryWithBindings,
}));

import { GET, POST } from "./route";

const ANON = { userId: "anonymous", email: "", role: "anonymous", customRoles: [] };
const MEMBER = { userId: "u1", email: "m@x.com", role: "member", customRoles: [] };
const STEWARD = { userId: "s1", email: "s@x.com", role: "steward", customRoles: [] };

// Swap the actor the mocked buildChatRuntime returns.
const as = (actor: typeof ANON) => {
  h.ACTOR = actor;
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/channels/bindings", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/channels/bindings — steward gate", () => {
  it("rejects anonymous with 401, never touching discovery/store", async () => {
    as(ANON);
    const res = await GET(new Request("http://localhost/api/channels/bindings"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(discoverChannels).not.toHaveBeenCalled();
    expect(listBindings).not.toHaveBeenCalled();
  });

  it("rejects a member with 403, never touching discovery/store", async () => {
    as(MEMBER);
    const res = await GET(new Request("http://localhost/api/channels/bindings"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(discoverChannels).not.toHaveBeenCalled();
    expect(listBindings).not.toHaveBeenCalled();
  });

  it("returns the merged channels view for a steward", async () => {
    as(STEWARD);
    const res = await GET(new Request("http://localhost/api/channels/bindings"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(discoverChannels).toHaveBeenCalledTimes(1);
    expect(listBindings).toHaveBeenCalledTimes(1);
    expect(mergeDiscoveryWithBindings).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/channels/bindings — steward gate", () => {
  it("rejects anonymous with 401, never touching the store", async () => {
    as(ANON);
    const res = await POST(
      post({ action: "bind", platform: "telegram", external_id: "1", scope: "group" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(bindTarget).not.toHaveBeenCalled();
  });

  it("rejects a member with 403, never touching the store", async () => {
    as(MEMBER);
    const res = await POST(
      post({ action: "bind", platform: "telegram", external_id: "1", scope: "group" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(bindTarget).not.toHaveBeenCalled();
  });
});

describe("POST /api/channels/bindings — actions", () => {
  it("400s an unknown action without writing", async () => {
    as(STEWARD);
    const res = await POST(
      post({ action: "nuke", platform: "telegram", external_id: "1" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(bindTarget).not.toHaveBeenCalled();
    expect(ignoreTarget).not.toHaveBeenCalled();
    expect(setEnabled).not.toHaveBeenCalled();
    expect(relabel).not.toHaveBeenCalled();
  });

  it("400s a malformed body (missing platform/external_id)", async () => {
    as(STEWARD);
    const res = await POST(post({ action: "bind" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(bindTarget).not.toHaveBeenCalled();
  });

  it("happy bind persists via bindTarget", async () => {
    as(STEWARD);
    const res = await POST(
      post({
        action: "bind",
        platform: "telegram",
        external_id: "-100123",
        sub_id: "42",
        scope: "topic",
        title: "Hostel Ops",
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(bindTarget).toHaveBeenCalledTimes(1);
    const arg = bindTarget.mock.calls[0][1] as Record<string, unknown>;
    expect(arg).toMatchObject({
      platform: "telegram",
      external_id: "-100123",
      sub_id: "42",
      scope: "topic",
    });
  });

  it("toggle routes to setEnabled with the requested flag", async () => {
    as(STEWARD);
    const res = await POST(
      post({ action: "toggle", platform: "discord", external_id: "g1", enabled: false }),
    );
    expect(res.status).toBe(200);
    expect(setEnabled).toHaveBeenCalledTimes(1);
    expect(setEnabled.mock.calls[0][2]).toBe(false);
  });
});
