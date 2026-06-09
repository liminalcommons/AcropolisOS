// app/api/channels/telegram/route.test.ts
//
// POST /api/channels/telegram — the inbound Telegram webhook. It is reachable
// WITHOUT a session (Telegram has no acropolisOS account) so it is guarded by a
// shared secret exactly like /api/ingest:
//   - 503 when TELEGRAM_WEBHOOK_SECRET is unset (endpoint inert),
//   - 401 on a missing/mismatched X-Telegram-Bot-Api-Secret-Token header,
//   - 400 on invalid JSON / malformed Update,
//   - 201 { ok, count, ids } on a valid Update, inserting via ingestChannelRows
//     with source='telegram'.
//
// The db is never touched: getDb is mocked to throw (any call is a bug) and
// ingestChannelRows is spied so we can assert it is called with source='telegram'
// and the parsed rows.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_UPDATE } from "@/lib/channels/telegram/types";

const FAKE_DB = { __fake: true };
const ingestSpy = vi.fn(async (_db: unknown, _source: string, rows: unknown[]) => ({
  ids: (rows as unknown[]).map((_, i) => `row-${i}`),
  count: (rows as unknown[]).length,
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => FAKE_DB,
}));
vi.mock("@/lib/channels/ingest", () => ({
  ingestChannelRows: (...args: unknown[]) => ingestSpy(...(args as [unknown, string, unknown[]])),
}));

const { POST } = await import("./route");

const HEADER = "X-Telegram-Bot-Api-Secret-Token";
const SECRET = "test-webhook-secret";

function makeReq(opts: { secret?: string | null; body?: unknown; rawBody?: string }): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.secret !== null && opts.secret !== undefined) headers.set(HEADER, opts.secret);
  const body =
    opts.rawBody !== undefined
      ? opts.rawBody
      : opts.body !== undefined
        ? JSON.stringify(opts.body)
        : undefined;
  return new Request("http://localhost/api/channels/telegram", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/channels/telegram", () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    ingestSpy.mockClear();
  });
  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it("returns 503 when TELEGRAM_WEBHOOK_SECRET is unset", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await POST(makeReq({ secret: "anything", body: SAMPLE_UPDATE }));
    expect(res.status).toBe(503);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("returns 401 on a mismatched secret", async () => {
    const res = await POST(makeReq({ secret: "wrong", body: SAMPLE_UPDATE }));
    expect(res.status).toBe(401);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("returns 401 when the secret header is missing", async () => {
    const res = await POST(makeReq({ secret: null, body: SAMPLE_UPDATE }));
    expect(res.status).toBe(401);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("does not leak the secret in the 401 body", async () => {
    const res = await POST(makeReq({ secret: "wrong", body: SAMPLE_UPDATE }));
    const text = await res.text();
    expect(text).not.toContain(SECRET);
  });

  it("returns 400 on invalid JSON", async () => {
    const res = await POST(makeReq({ secret: SECRET, rawBody: "{not json" }));
    expect(res.status).toBe(400);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed Update (missing update_id)", async () => {
    const res = await POST(makeReq({ secret: SECRET, body: { message: { text: "hi" } } }));
    expect(res.status).toBe(400);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("returns 200 with count 0 for an Update carrying no message content", async () => {
    const res = await POST(makeReq({ secret: SECRET, body: { update_id: 1 } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; count: number; ids: string[] };
    expect(body).toEqual({ ok: true, count: 0, ids: [] });
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("returns 201 with { ok, count, ids } and ingests with source='telegram'", async () => {
    const res = await POST(makeReq({ secret: SECRET, body: SAMPLE_UPDATE }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; count: number; ids: string[] };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(body.ids).toHaveLength(1);

    expect(ingestSpy).toHaveBeenCalledTimes(1);
    const [dbArg, sourceArg, rowsArg] = ingestSpy.mock.calls[0];
    expect(dbArg).toBe(FAKE_DB);
    expect(sourceArg).toBe("telegram");
    expect(rowsArg).toHaveLength(1);
    expect((rowsArg[0] as { text: string }).text).toBe(SAMPLE_UPDATE.message!.text);
  });
});
