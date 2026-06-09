// app/api/ingest/route.test.ts
//
// Characterization test for the open /api/ingest webhook. It pins the route's
// PUBLIC behavior so the task-6 refactor (replace the inline insert with the
// shared ingestChannelRows helper) provably does not change it:
//   - 503 when INGEST_TOKEN is unset,
//   - 401 on a missing/mismatched token (x-ingest-token or Bearer),
//   - 400 on invalid JSON / empty payload / non-object rows,
//   - 201 { ok, count, ids } inserting into raw_inbox with source='webhook'.
//
// The db is faked. The fake supports BOTH the legacy one-shot
// insert(...).values(...).returning(...) AND the chunked transaction(cb) path,
// so this test is valid before AND after the refactor, recording the rows that
// were inserted and the source stamped on them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inserted: { source: string; payload: unknown }[] = [];
let idCounter = 0;

function makeInsertBuilder() {
  return {
    values(values: { source: string; payload: unknown }[]) {
      return {
        async returning(_cols: unknown) {
          for (const v of values) inserted.push(v);
          return values.map(() => ({ id: `id-${idCounter++}` }));
        },
      };
    },
  };
}

const FAKE_DB = {
  insert: (_table: unknown) => makeInsertBuilder(),
  async transaction(cb: (tx: { insert: (t: unknown) => ReturnType<typeof makeInsertBuilder> }) => Promise<void>) {
    await cb({ insert: () => makeInsertBuilder() });
  },
};

vi.mock("@/lib/db/client", () => ({
  getDb: () => FAKE_DB,
}));

const { POST } = await import("./route");

const TOKEN = "ingest-token-xyz";

function makeReq(opts: {
  token?: string | null;
  bearer?: string;
  body?: unknown;
  rawBody?: string;
}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.token !== null && opts.token !== undefined) headers.set("x-ingest-token", opts.token);
  if (opts.bearer) headers.set("authorization", `Bearer ${opts.bearer}`);
  const body =
    opts.rawBody !== undefined
      ? opts.rawBody
      : opts.body !== undefined
        ? JSON.stringify(opts.body)
        : undefined;
  return new Request("http://localhost/api/ingest", { method: "POST", headers, body });
}

describe("POST /api/ingest", () => {
  beforeEach(() => {
    process.env.INGEST_TOKEN = TOKEN;
    inserted.length = 0;
    idCounter = 0;
  });
  afterEach(() => {
    delete process.env.INGEST_TOKEN;
  });

  it("returns 503 when INGEST_TOKEN is unset", async () => {
    delete process.env.INGEST_TOKEN;
    const res = await POST(makeReq({ token: TOKEN, body: { a: 1 } }));
    expect(res.status).toBe(503);
    expect(inserted).toEqual([]);
  });

  it("returns 401 on a missing token", async () => {
    const res = await POST(makeReq({ token: null, body: { a: 1 } }));
    expect(res.status).toBe(401);
    expect(inserted).toEqual([]);
  });

  it("returns 401 on a mismatched token", async () => {
    const res = await POST(makeReq({ token: "wrong", body: { a: 1 } }));
    expect(res.status).toBe(401);
  });

  it("accepts the token via a Bearer authorization header", async () => {
    const res = await POST(makeReq({ token: null, bearer: TOKEN, body: { a: 1 } }));
    expect(res.status).toBe(201);
  });

  it("returns 400 on invalid JSON", async () => {
    const res = await POST(makeReq({ token: TOKEN, rawBody: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on an empty array payload", async () => {
    const res = await POST(makeReq({ token: TOKEN, body: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when a row is not a JSON object", async () => {
    const res = await POST(makeReq({ token: TOKEN, body: [{ ok: 1 }, "nope"] }));
    expect(res.status).toBe(400);
    expect(inserted).toEqual([]);
  });

  it("inserts a single object with source='webhook' and returns { ok, count, ids }", async () => {
    const res = await POST(makeReq({ token: TOKEN, body: { name: "ada", city: "rio" } }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; count: number; ids: string[] };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(body.ids).toHaveLength(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].source).toBe("webhook");
    expect(inserted[0].payload).toEqual({ name: "ada", city: "rio" });
  });

  it("inserts an array of objects, each as a webhook row", async () => {
    const rows = [{ k: 1 }, { k: 2 }, { k: 3 }];
    const res = await POST(makeReq({ token: TOKEN, body: rows }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { count: number; ids: string[] };
    expect(body.count).toBe(3);
    expect(inserted.map((r) => r.payload)).toEqual(rows);
    expect(inserted.every((r) => r.source === "webhook")).toBe(true);
  });
});
