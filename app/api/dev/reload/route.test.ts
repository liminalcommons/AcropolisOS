// US-022: SSE reload endpoint tests.
//
// GET subscribes the caller to the reload bus and emits SSE-formatted
// `event: reload\ndata: <json>` frames whenever the bus publishes.
// POST publishes to the bus — the dev-watch script POSTs here after each
// codegen pass.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/dev/reload-bus", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dev/reload-bus")>(
    "@/lib/dev/reload-bus",
  );
  // Each test gets a fresh bus so subscriptions don't bleed across runs.
  const bus = actual.createReloadBus();
  return {
    ...actual,
    getDefaultReloadBus: () => bus,
  };
});

describe("dev reload route", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("POST publishes the event and returns ok", async () => {
    const { POST } = await import("./route");
    const { getDefaultReloadBus } = await import("@/lib/dev/reload-bus");

    const received: unknown[] = [];
    getDefaultReloadBus().subscribe((e) => received.push(e));

    const res = await POST(
      new Request("http://localhost/api/dev/reload", {
        method: "POST",
        body: JSON.stringify({
          kind: "ontology",
          at: 123,
          paths: ["seed/member.yaml"],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { ok: boolean };
    expect(payload.ok).toBe(true);

    expect(received).toEqual([
      { kind: "ontology", at: 123, paths: ["seed/member.yaml"] },
    ]);
  });

  it("POST rejects malformed bodies", async () => {
    const { POST } = await import("./route");

    const res = await POST(
      new Request("http://localhost/api/dev/reload", {
        method: "POST",
        body: "{not json",
      }),
    );

    expect(res.status).toBe(400);
  });

  it("POST rejects bodies missing kind/paths", async () => {
    const { POST } = await import("./route");

    const res = await POST(
      new Request("http://localhost/api/dev/reload", {
        method: "POST",
        body: JSON.stringify({ at: 1 }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("GET streams an SSE frame for each published event", async () => {
    const { GET } = await import("./route");
    const { getDefaultReloadBus } = await import("@/lib/dev/reload-bus");

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.body).toBeTruthy();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Pull the initial comment ping (kept-alive marker).
    const first = await reader.read();
    expect(first.done).toBe(false);
    buffer += decoder.decode(first.value);
    expect(buffer).toMatch(/^: connected/);

    getDefaultReloadBus().publish({
      kind: "ontology",
      at: 42,
      paths: ["m.yaml"],
    });

    // Drain frames until we see the reload event.
    while (!buffer.includes("event: reload")) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
    }
    expect(buffer).toMatch(/event: reload/);
    expect(buffer).toMatch(/"kind":"ontology"/);
    expect(buffer).toMatch(/"at":42/);

    await reader.cancel();
  });
});
