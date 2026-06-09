// lib/channels/telegram/types.test.ts
//
// The Telegram Update type is the minimal shape the adapter parses. It is a
// TYPE (erased at runtime), so RED/GREEN for the contract is enforced by tsc:
// a fixture object typed as TelegramUpdate must compile, and the SAMPLE_UPDATE
// test fixture must expose the fields the adapter relies on. This test also
// pins the fixture so the integration test (task 7) can import a realistic
// Update without redefining it.

import { describe, expect, it } from "vitest";
import { SAMPLE_UPDATE } from "@/lib/channels/telegram/types";
import type { TelegramUpdate } from "@/lib/channels/telegram/types";

describe("TelegramUpdate type + SAMPLE_UPDATE fixture", () => {
  it("a minimal Update with a text message compiles and carries the parsed fields", () => {
    const update: TelegramUpdate = {
      update_id: 100,
      message: {
        message_id: 7,
        from: { id: 42, is_bot: false, first_name: "Ada" },
        chat: { id: -100, type: "group" },
        date: 1717000000,
        text: "hello world",
      },
    };
    expect(update.update_id).toBe(100);
    expect(update.message?.text).toBe("hello world");
    expect(update.message?.from?.id).toBe(42);
    expect(update.message?.chat.id).toBe(-100);
  });

  it("optional message-like fields (edited_message, channel_post) are allowed", () => {
    const edited: TelegramUpdate = {
      update_id: 101,
      edited_message: {
        message_id: 8,
        chat: { id: 5, type: "private" },
        date: 1717000001,
        text: "edited",
      },
    };
    const post: TelegramUpdate = {
      update_id: 102,
      channel_post: {
        message_id: 9,
        chat: { id: -200, type: "channel" },
        date: 1717000002,
        caption: "a caption",
      },
    };
    expect(edited.edited_message?.text).toBe("edited");
    expect(post.channel_post?.caption).toBe("a caption");
  });

  it("SAMPLE_UPDATE fixture is a realistic text-message Update", () => {
    expect(SAMPLE_UPDATE.update_id).toBeTypeOf("number");
    expect(SAMPLE_UPDATE.message?.text).toBeTypeOf("string");
    expect(SAMPLE_UPDATE.message?.from?.id).toBeTypeOf("number");
    expect(SAMPLE_UPDATE.message?.chat.id).toBeTypeOf("number");
    expect(SAMPLE_UPDATE.message?.message_id).toBeTypeOf("number");
  });
});
