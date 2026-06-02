// app/api/channels/telegram/route.integration.test.ts
//
// End-to-end (db-mocked) integration: a realistic Telegram Update POSTed to
// /api/channels/telegram flows through the REAL route + REAL TelegramAdapter +
// REAL ingestChannelRows, with only the Postgres transaction faked. We assert
// the full path produces a raw_inbox insert with source='telegram' and the
// extracted fields — no piece is stubbed except the database itself.
//
// Unlike route.test.ts (which mocks ingestChannelRows to isolate the handler),
// this test wires the actual helper so adapter -> helper -> insert is exercised
// as one unit.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_UPDATE } from "@/lib/channels/telegram/types";

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
            return values.map(() => ({ id: `tg-${idCounter++}` }));
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

const HEADER = "X-Telegram-Bot-Api-Secret-Token";
const SECRET = "integration-secret";

describe("Telegram webhook -> raw_inbox (integration, db mocked)", () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    insertedRows.length = 0;
    idCounter = 0;
  });
  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it("verifies, parses, and inserts a realistic Update as a raw_inbox row", async () => {
    const req = new Request("http://localhost/api/channels/telegram", {
      method: "POST",
      headers: { "content-type": "application/json", [HEADER]: SECRET },
      body: JSON.stringify(SAMPLE_UPDATE),
    });

    const res = await POST(req);

    // (4) response shape
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; count: number; ids: string[] };
    expect(body).toEqual({ ok: true, count: 1, ids: ["tg-0"] });

    // (1)+(2)+(3) one row inserted, source='telegram', extracted fields present
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].source).toBe("telegram");
    expect(insertedRows[0].payload).toMatchObject({
      text: SAMPLE_UPDATE.message!.text,
      user_id: SAMPLE_UPDATE.message!.from!.id,
      chat_id: SAMPLE_UPDATE.message!.chat.id,
      message_id: SAMPLE_UPDATE.message!.message_id,
      update_id: SAMPLE_UPDATE.update_id,
    });
  });

  it("rejects (401) a forged request and never touches raw_inbox", async () => {
    const req = new Request("http://localhost/api/channels/telegram", {
      method: "POST",
      headers: { "content-type": "application/json", [HEADER]: "forged" },
      body: JSON.stringify(SAMPLE_UPDATE),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(insertedRows).toEqual([]);
  });
});
