import { describe, expect, it } from "vitest";
import { chatPasteRow, CHAT_PASTE_SOURCE } from "./stage-text";

describe("chatPasteRow (chat-paste -> raw_inbox shape)", () => {
  it("trims the text and uses the chat-paste source", () => {
    expect(chatPasteRow("  here are our guests: Ana, Bob  ")).toEqual({
      source: CHAT_PASTE_SOURCE,
      payload: { text: "here are our guests: Ana, Bob" },
    });
  });
  it("includes a trimmed label when given, omits it when blank", () => {
    expect(chatPasteRow("x", "  guests  ")).toEqual({
      source: "chat-paste",
      payload: { text: "x", label: "guests" },
    });
    expect(chatPasteRow("x", "   ")).toEqual({ source: "chat-paste", payload: { text: "x" } });
    expect(chatPasteRow("x")).toEqual({ source: "chat-paste", payload: { text: "x" } });
  });
});
