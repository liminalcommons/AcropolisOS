// app/api/channels/discord/route.integration.test.ts
//
// End-to-end (db-mocked) integration: a realistic Discord APPLICATION_COMMAND
// interaction, signed with a generated Ed25519 key whose raw public half is set
// as DISCORD_PUBLIC_KEY, POSTed to /api/channels/discord flows through the REAL
// route + REAL discordAdapter + REAL verifyDiscordSignature + REAL
// ingestChannelRows, with ONLY the Postgres transaction faked. We assert the
// full path produces ONE raw_inbox row with source='discord' and the extracted
// command/options, and that a forged signature yields 401 and inserts nothing.
//
// Unlike route.test.ts (which mocks ingestChannelRows and verify is exercised
// against a real key too), this test wires the actual ingest helper so
// route -> verify -> adapter -> helper -> insert is exercised as one unit.

import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_INTERACTION } from "@/lib/channels/discord/types";

// Capture exactly what hits raw_inbox via the transactional insert path.
const insertedRows: { source: string; payload: Record<string, unknown> }[] = [];
let idCounter = 0;

const FAKE_DB = {
  async transaction(
    cb: (tx: {
      insert: (t: unknown) => {
        values: (v: { source: string; payload: Record<string, unknown> }[]) => {
          returning: (cols: unknown) => Promise<{ id: string }[]>;
        };
      };
    }) => Promise<void>,
  ) {
    await cb({
      insert: () => ({
        values: (values) => ({
          returning: async () => {
            for (const v of values) insertedRows.push(v);
            return values.map(() => ({ id: `dc-${idCounter++}` }));
          },
        }),
      }),
    });
  },
};

vi.mock("@/lib/db/client", () => ({
  getDb: () => FAKE_DB,
}));

const { POST } = await import("./route");

const SIG_HEADER = "X-Signature-Ed25519";
const TS_HEADER = "X-Signature-Timestamp";

// Real keypair: DISCORD_PUBLIC_KEY = raw 32-byte hex public half.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ type: "spki", format: "der" });
const PUBLIC_KEY_HEX = Buffer.from(spki.subarray(spki.length - 32)).toString("hex");

function makeSignedRequest(body: unknown, opts: { forge?: boolean } = {}): Request {
  const rawBody = JSON.stringify(body);
  const timestamp = "1717209999";
  const message = opts.forge ? timestamp + "tampered" : timestamp + rawBody;
  const signatureHex = sign(null, Buffer.from(message), privateKey).toString("hex");
  return new Request("http://localhost/api/channels/discord", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SIG_HEADER]: signatureHex,
      [TS_HEADER]: timestamp,
    },
    body: rawBody,
  });
}

describe("Discord interactions endpoint -> raw_inbox (integration, db mocked)", () => {
  beforeEach(() => {
    process.env.DISCORD_PUBLIC_KEY = PUBLIC_KEY_HEX;
    insertedRows.length = 0;
    idCounter = 0;
  });
  afterEach(() => {
    delete process.env.DISCORD_PUBLIC_KEY;
  });

  it("verifies, parses, and inserts a signed APPLICATION_COMMAND as a raw_inbox row", async () => {
    const res = await POST(makeSignedRequest(SAMPLE_INTERACTION));

    // wire body is the {type:4} ack only
    expect(res.status).toBe(201);
    const body = (await res.json()) as { type: number; data?: { content?: string } };
    expect(body.type).toBe(4);
    expect(typeof body.data?.content).toBe("string");
    expect(body).not.toHaveProperty("ok");

    // internal accounting via header
    const result = JSON.parse(res.headers.get("X-Ingest-Result")!) as {
      ok: boolean;
      count: number;
      ids: string[];
    };
    expect(result).toEqual({ ok: true, count: 1, ids: ["dc-0"] });

    // one row inserted, source='discord', extracted fields present
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].source).toBe("discord");
    expect(insertedRows[0].payload).toMatchObject({
      command: SAMPLE_INTERACTION.data!.name,
      options: SAMPLE_INTERACTION.data!.options,
      interaction_id: SAMPLE_INTERACTION.id,
      guild_id: SAMPLE_INTERACTION.guild_id,
      channel_id: SAMPLE_INTERACTION.channel_id,
      user_id: SAMPLE_INTERACTION.member!.user.id,
    });
  });

  it("rejects (401) a forged signature and never touches raw_inbox", async () => {
    const res = await POST(makeSignedRequest(SAMPLE_INTERACTION, { forge: true }));
    expect(res.status).toBe(401);
    expect(insertedRows).toEqual([]);
  });
});
