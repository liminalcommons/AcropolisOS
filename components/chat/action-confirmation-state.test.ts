// M2.2 step-6: detect pending apply_action confirmations in a UIMessage stream.
//
// The route's apply_action tool returns ApplyActionResult; when the policy
// gate decides confirmation_required, ok:false and the envelope is populated.
// This helper scans assistant messages for the most recent un-acted
// confirmation and surfaces it to the chat panel UI so a card can render.

import { describe, expect, it } from "vitest";
import {
  pickPendingConfirmation,
  type ChatLikeMessage,
} from "./action-confirmation-state";

function asst(parts: ChatLikeMessage["parts"]): ChatLikeMessage {
  return { id: "m", role: "assistant", parts };
}

describe("pickPendingConfirmation — M2.2 step 6", () => {
  it("returns null when there are no messages", () => {
    expect(pickPendingConfirmation([])).toBeNull();
  });

  it("returns null when no tool output mentions confirmation_required", () => {
    const msgs: ChatLikeMessage[] = [
      asst([{ type: "text", text: "Hello, how can I help?" }]),
    ];
    expect(pickPendingConfirmation(msgs)).toBeNull();
  });

  it("picks the most recent apply_action confirmation envelope", () => {
    const msgs: ChatLikeMessage[] = [
      asst([
        {
          type: "tool-apply_action",
          toolCallId: "c-old",
          output: {
            ok: false,
            confirmation_required: {
              action: "change_tier",
              params: { member: "m-1", new_tier: "lifetime" },
              reason: "always_confirm",
              required_permissions: ["steward"],
            },
          },
        },
      ]),
      asst([{ type: "text", text: "Want me to proceed?" }]),
      asst([
        {
          type: "tool-apply_action",
          toolCallId: "c-new",
          output: {
            ok: false,
            confirmation_required: {
              action: "change_tier",
              params: { member: "m-2", new_tier: "sustaining" },
              reason: "always_confirm",
              required_permissions: ["steward"],
            },
          },
        },
      ]),
    ];

    const found = pickPendingConfirmation(msgs);
    expect(found).not.toBeNull();
    expect(found!.toolCallId).toBe("c-new");
    expect(found!.envelope.action).toBe("change_tier");
    expect(found!.envelope.params).toEqual({
      member: "m-2",
      new_tier: "sustaining",
    });
  });

  it("filters out confirmations already in the dismissed set", () => {
    const msgs: ChatLikeMessage[] = [
      asst([
        {
          type: "tool-apply_action",
          toolCallId: "c-1",
          output: {
            ok: false,
            confirmation_required: {
              action: "change_tier",
              params: { member: "m-1", new_tier: "lifetime" },
              reason: "always_confirm",
              required_permissions: ["steward"],
            },
          },
        },
      ]),
    ];
    expect(pickPendingConfirmation(msgs, new Set(["c-1"]))).toBeNull();
  });

  it("skips tool outputs where ok=true (already applied)", () => {
    const msgs: ChatLikeMessage[] = [
      asst([
        {
          type: "tool-apply_action",
          toolCallId: "c-1",
          output: {
            ok: true,
            audit_id: "audit-x",
            result: { ok: true, member: "m" },
          },
        },
      ]),
    ];
    expect(pickPendingConfirmation(msgs)).toBeNull();
  });

  it("tolerates user messages and unrelated tool parts", () => {
    const msgs: ChatLikeMessage[] = [
      { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] },
      asst([
        {
          type: "tool-propose_object_type",
          toolCallId: "p-1",
          output: { ok: true },
        },
      ]),
    ];
    expect(pickPendingConfirmation(msgs)).toBeNull();
  });
});
