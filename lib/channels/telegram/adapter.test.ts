// lib/channels/telegram/adapter.test.ts
//
// The TelegramAdapter implements ChannelAdapter for inbound Telegram webhooks.
//
// verifyRequest: Telegram signs webhook deliveries with the
//   X-Telegram-Bot-Api-Secret-Token header, which must constant-time-match the
//   configured env secret. Unset env => reject (inert). Missing/mismatched
//   header => reject. The secret is never logged or echoed.
//
// parsePayload: turns an Update into raw_inbox rows. It extracts text/caption
//   (and a document marker) from whichever message-like field is present, and
//   stamps the identity fields (user_id, chat_id, message_id, update_id).
//   An Update with no message content yields an empty array (not an error).
//   A non-object / missing-update_id body throws a SAFE error.

import { describe, expect, it } from "vitest";
import { telegramAdapter } from "@/lib/channels/telegram/adapter";
import { SAMPLE_UPDATE } from "@/lib/channels/telegram/types";

const HEADER = "X-Telegram-Bot-Api-Secret-Token";

function reqWithSecret(secret: string | null): Request {
  const headers = new Headers();
  if (secret !== null) headers.set(HEADER, secret);
  return new Request("http://localhost/api/channels/telegram", {
    method: "POST",
    headers,
  });
}

describe("telegramAdapter.source", () => {
  it("is 'telegram'", () => {
    expect(telegramAdapter.source).toBe("telegram");
  });
});

describe("telegramAdapter.verifyRequest", () => {
  it("accepts a request whose secret header matches the env secret", () => {
    expect(telegramAdapter.verifyRequest(reqWithSecret("s3cr3t"), "s3cr3t")).toBe(true);
  });

  it("rejects a mismatched secret header", () => {
    expect(telegramAdapter.verifyRequest(reqWithSecret("wrong"), "s3cr3t")).toBe(false);
  });

  it("rejects when the secret header is missing", () => {
    expect(telegramAdapter.verifyRequest(reqWithSecret(null), "s3cr3t")).toBe(false);
  });

  it("rejects (inert) when the env secret is unset", () => {
    expect(telegramAdapter.verifyRequest(reqWithSecret("anything"), undefined)).toBe(false);
    expect(telegramAdapter.verifyRequest(reqWithSecret(""), undefined)).toBe(false);
  });

  it("rejects when provided and expected differ in length (no throw)", () => {
    expect(telegramAdapter.verifyRequest(reqWithSecret("short"), "a-much-longer-secret")).toBe(false);
  });
});

describe("telegramAdapter.parsePayload", () => {
  it("extracts text + identity fields from a message", async () => {
    const rows = await telegramAdapter.parsePayload(SAMPLE_UPDATE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      text: SAMPLE_UPDATE.message!.text,
      user_id: SAMPLE_UPDATE.message!.from!.id,
      chat_id: SAMPLE_UPDATE.message!.chat.id,
      message_id: SAMPLE_UPDATE.message!.message_id,
      update_id: SAMPLE_UPDATE.update_id,
    });
  });

  it("extracts a caption when there is no text", async () => {
    const rows = await telegramAdapter.parsePayload({
      update_id: 5,
      message: {
        message_id: 1,
        from: { id: 9, is_bot: false },
        chat: { id: 3, type: "private" },
        date: 1,
        caption: "photo caption",
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("photo caption");
    expect(rows[0].user_id).toBe(9);
  });

  it("captures a document file_id alongside the text", async () => {
    const rows = await telegramAdapter.parsePayload({
      update_id: 6,
      message: {
        message_id: 2,
        from: { id: 9, is_bot: false },
        chat: { id: 3, type: "private" },
        date: 1,
        caption: "see attached",
        document: { file_id: "BQACfile123", file_name: "roster.pdf" },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("see attached");
    expect(rows[0].document_file_id).toBe("BQACfile123");
  });

  it("reads from edited_message and channel_post too", async () => {
    const edited = await telegramAdapter.parsePayload({
      update_id: 7,
      edited_message: {
        message_id: 3,
        from: { id: 11, is_bot: false },
        chat: { id: 4, type: "group" },
        date: 1,
        text: "edited text",
      },
    });
    expect(edited[0].text).toBe("edited text");

    const post = await telegramAdapter.parsePayload({
      update_id: 8,
      channel_post: {
        message_id: 4,
        chat: { id: -5, type: "channel" },
        date: 1,
        text: "channel announcement",
      },
    });
    expect(post[0].text).toBe("channel announcement");
    // channel posts have no `from` -> user_id is null, not a throw
    expect(post[0].user_id).toBeNull();
  });

  it("returns multiple rows when an Update carries more than one message-like field", async () => {
    const rows = await telegramAdapter.parsePayload({
      update_id: 9,
      message: { message_id: 1, from: { id: 1, is_bot: false }, chat: { id: 1, type: "private" }, date: 1, text: "a" },
      channel_post: { message_id: 2, chat: { id: 2, type: "channel" }, date: 1, text: "b" },
    });
    expect(rows.map((r) => r.text).sort()).toEqual(["a", "b"]);
  });

  it("returns an empty array for an Update with no message content (not an error)", async () => {
    const rows = await telegramAdapter.parsePayload({ update_id: 10 });
    expect(rows).toEqual([]);
  });

  it("skips message-like fields with neither text/caption nor document", async () => {
    // e.g. a service message (new_chat_member, etc.) we do not model
    const rows = await telegramAdapter.parsePayload({
      update_id: 11,
      message: { message_id: 1, from: { id: 1, is_bot: false }, chat: { id: 1, type: "group" }, date: 1 },
    });
    expect(rows).toEqual([]);
  });

  it("throws a safe error for a non-object body", async () => {
    await expect(telegramAdapter.parsePayload("not an object")).rejects.toThrow(/invalid telegram update/i);
    await expect(telegramAdapter.parsePayload(null)).rejects.toThrow(/invalid telegram update/i);
    await expect(telegramAdapter.parsePayload([1, 2, 3])).rejects.toThrow(/invalid telegram update/i);
  });

  it("throws a safe error when update_id is missing/invalid", async () => {
    await expect(telegramAdapter.parsePayload({ message: { message_id: 1 } })).rejects.toThrow(
      /invalid telegram update/i,
    );
  });

  it("additively captures chat title, chat type, and message thread (topic) id", async () => {
    const rows = await telegramAdapter.parsePayload({
      update_id: 12,
      message: {
        message_id: 7,
        from: { id: 9, is_bot: false },
        chat: { id: -1002233445566, type: "supergroup", title: "Hostel Ops" },
        message_thread_id: 42,
        date: 1,
        text: "topic message",
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chat_title: "Hostel Ops",
      chat_type: "supergroup",
      message_thread_id: 42,
    });
  });

  it("leaves chat_title / message_thread_id undefined when absent (omitted from jsonb)", async () => {
    const rows = await telegramAdapter.parsePayload({
      update_id: 13,
      message: {
        message_id: 8,
        from: { id: 9, is_bot: false },
        chat: { id: 3, type: "private" },
        date: 1,
        text: "private dm, no title or topic",
      },
    });
    expect(rows).toHaveLength(1);
    // private chats have no title / thread — `?? undefined` leaves the value
    // undefined so JSON serialization (the jsonb payload) drops the keys.
    expect(rows[0].chat_title).toBeUndefined();
    expect(rows[0].message_thread_id).toBeUndefined();
    const serialized = JSON.parse(JSON.stringify(rows[0]));
    expect(serialized).not.toHaveProperty("chat_title");
    expect(serialized).not.toHaveProperty("message_thread_id");
    // chat_type is still captured for any chat
    expect(rows[0].chat_type).toBe("private");
  });
});

// The additive parsePayload change must NOT weaken the secret gate. These
// assertions duplicate the verifyRequest guarantees inside the A2 change set so
// any regression to the gate fails the same suite that widened the payload.
describe("telegramAdapter.verifyRequest stays intact alongside the A2 payload widening", () => {
  it("rejects a wrong secret header", () => {
    expect(telegramAdapter.verifyRequest(reqWithSecret("wrong"), "s3cr3t")).toBe(false);
  });

  it("rejects when the env secret is unset (inert)", () => {
    expect(telegramAdapter.verifyRequest(reqWithSecret("anything"), undefined)).toBe(false);
  });

  it("still accepts a correctly matching secret", () => {
    expect(telegramAdapter.verifyRequest(reqWithSecret("s3cr3t"), "s3cr3t")).toBe(true);
  });
});
