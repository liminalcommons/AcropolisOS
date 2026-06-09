// app/api/channels/discord/route.test.ts
//
// POST /api/channels/discord — the inbound Discord Interactions Endpoint. It is
// reachable WITHOUT a session (Discord has no acropolisOS account) so it is
// guarded by Discord's Ed25519 signature, verified against DISCORD_PUBLIC_KEY:
//   - 503 when DISCORD_PUBLIC_KEY is unset (endpoint inert — no open hole),
//   - 401 on a missing/invalid signature (and the body never leaks the key),
//   - 200 {type:1} on a validly-signed PING (type 1) — the PONG handshake,
//   - 400 on invalid JSON,
//   - 2xx {type:4,data:{content}} on a validly-signed APPLICATION_COMMAND,
//     having inserted via ingestChannelRows with source='discord'.
//
// THE WIRE CONTRACT (C1): the JSON body Discord reads MUST be EXACTLY the
// interaction-response object — {type:1} for PING, {type:4,data:{content}} for a
// command — and nothing co-mingled. The internal {ok,count,ids} accounting is
// surfaced ONLY via the X-Ingest-Result header (test-only), never in the body.
//
// THE ORDER CONTRACT (C3): a PING must short-circuit to {type:1} BEFORE
// parsePayload — it must NEVER fall through to an empty-rows branch.
//
// The db is never touched: getDb is mocked to throw (any call is a bug) and
// ingestChannelRows is spied so we can assert source='discord' and the rows.

import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_INTERACTION, SAMPLE_PING } from "@/lib/channels/discord/types";

const FAKE_DB = { __fake: true };
const ingestSpy = vi.fn(async (_db: unknown, _source: string, rows: unknown[]) => ({
  ids: (rows as unknown[]).map((_, i) => `row-${i}`),
  count: (rows as unknown[]).length,
}));

// getDb returns a sentinel: the route hands it to ingestChannelRows, which is
// mocked, so no real DB connection is opened. We assert the sentinel is what the
// route passed through.
vi.mock("@/lib/db/client", () => ({
  getDb: () => FAKE_DB,
}));
vi.mock("@/lib/channels/ingest", () => ({
  ingestChannelRows: (...args: unknown[]) => ingestSpy(...(args as [unknown, string, unknown[]])),
}));

const { POST } = await import("./route");

const SIG_HEADER = "X-Signature-Ed25519";
const TS_HEADER = "X-Signature-Timestamp";

// A real keypair: DISCORD_PUBLIC_KEY = raw 32-byte hex; sign (timestamp+rawBody).
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ type: "spki", format: "der" });
const PUBLIC_KEY_HEX = Buffer.from(spki.subarray(spki.length - 32)).toString("hex");

function signReq(opts: {
  body: unknown;
  rawBody?: string;
  timestamp?: string;
  signWith?: "valid" | "forged" | "none";
  sig?: string;
}): Request {
  const rawBody = opts.rawBody ?? JSON.stringify(opts.body);
  const timestamp = opts.timestamp ?? "1717200000";
  const headers = new Headers({ "content-type": "application/json" });
  headers.set(TS_HEADER, timestamp);
  const mode = opts.signWith ?? "valid";
  if (opts.sig !== undefined) {
    headers.set(SIG_HEADER, opts.sig);
  } else if (mode === "valid") {
    const s = sign(null, Buffer.from(timestamp + rawBody), privateKey).toString("hex");
    headers.set(SIG_HEADER, s);
  } else if (mode === "forged") {
    // a valid-shape but wrong signature (signed over different bytes)
    const s = sign(null, Buffer.from(timestamp + "tampered"), privateKey).toString("hex");
    headers.set(SIG_HEADER, s);
  }
  // mode === "none" -> no signature header at all
  return new Request("http://localhost/api/channels/discord", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

describe("POST /api/channels/discord", () => {
  beforeEach(() => {
    process.env.DISCORD_PUBLIC_KEY = PUBLIC_KEY_HEX;
    ingestSpy.mockClear();
  });
  afterEach(() => {
    delete process.env.DISCORD_PUBLIC_KEY;
  });

  it("returns 503 when DISCORD_PUBLIC_KEY is unset", async () => {
    delete process.env.DISCORD_PUBLIC_KEY;
    const res = await POST(signReq({ body: SAMPLE_PING }));
    expect(res.status).toBe(503);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("returns 401 on a forged signature", async () => {
    const res = await POST(signReq({ body: SAMPLE_INTERACTION, signWith: "forged" }));
    expect(res.status).toBe(401);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature header is missing", async () => {
    const res = await POST(signReq({ body: SAMPLE_INTERACTION, signWith: "none" }));
    expect(res.status).toBe(401);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("does not leak the public key in the 401 body", async () => {
    const res = await POST(signReq({ body: SAMPLE_INTERACTION, signWith: "forged" }));
    const text = await res.text();
    expect(text).not.toContain(PUBLIC_KEY_HEX);
  });

  it("returns 200 with EXACTLY {type:1} on a validly-signed PING (PONG)", async () => {
    const res = await POST(signReq({ body: SAMPLE_PING }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // C1+C3: the body Discord reads is EXACTLY {type:1}, nothing co-mingled,
    // and it never fell through to an {ok,count:0} empty-rows branch.
    expect(body).toEqual({ type: 1 });
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("a forged PING never PONGs (401, no {type:1})", async () => {
    const res = await POST(signReq({ body: SAMPLE_PING, signWith: "forged" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).not.toEqual({ type: 1 });
  });

  it("returns 400 on invalid JSON (after a valid signature over the raw bytes)", async () => {
    const res = await POST(signReq({ body: undefined, rawBody: "{not json" }));
    expect(res.status).toBe(400);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("on a validly-signed command: wire body is EXACTLY {type:4,data:{content}} and ingests with source='discord'", async () => {
    const res = await POST(signReq({ body: SAMPLE_INTERACTION }));
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    // C1: the Discord-visible body is the interaction-response object only.
    const body = (await res.json()) as { type: number; data?: { content?: string } };
    expect(body.type).toBe(4);
    expect(typeof body.data?.content).toBe("string");
    expect(body).not.toHaveProperty("ok");
    expect(body).not.toHaveProperty("count");
    expect(body).not.toHaveProperty("ids");

    // internal accounting is exposed via a header, not the body
    const header = res.headers.get("X-Ingest-Result");
    expect(header).toBeTruthy();
    const parsed = JSON.parse(header!) as { ok: boolean; count: number; ids: string[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.count).toBe(1);

    expect(ingestSpy).toHaveBeenCalledTimes(1);
    const [dbArg, sourceArg, rowsArg] = ingestSpy.mock.calls[0];
    expect(dbArg).toBe(FAKE_DB);
    expect(sourceArg).toBe("discord");
    expect(rowsArg).toHaveLength(1);
    expect((rowsArg[0] as { command: string }).command).toBe(SAMPLE_INTERACTION.data!.name);
  });

  it("returns a {type:4} ack (no ingest) for a validly-signed but unmodeled interaction type", async () => {
    const res = await POST(
      signReq({ body: { type: 3, id: "i", application_id: "a", token: "t" } }),
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    const body = (await res.json()) as { type: number };
    expect(body.type).toBe(4);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("does not register a GET handler (Discord only POSTs)", async () => {
    const mod = await import("./route");
    expect((mod as Record<string, unknown>).GET).toBeUndefined();
  });
});
