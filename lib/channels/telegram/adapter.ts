// lib/channels/telegram/adapter.ts
//
// TelegramAdapter — the inbound Telegram channel adapter (data-only).
//
// verifyRequest: Telegram stamps every webhook delivery with the
//   X-Telegram-Bot-Api-Secret-Token header (set via setWebhook's secret_token).
//   We constant-time-compare it against TELEGRAM_WEBHOOK_SECRET (passed in by
//   the route as `envSecret`). Unset env -> reject (endpoint inert). The secret
//   is never logged or returned. We use node:crypto timingSafeEqual exactly as
//   the open /ingest route does.
//
// parsePayload: maps an Update's message-like fields into raw_inbox rows. We do
//   NOT map the Telegram user to an acropolisOS actor, read the ontology fence,
//   or invoke any agent action — this is pure data capture. Downstream
//   classification (a later slice) interprets the rows.

import { timingSafeEqual } from "node:crypto";
import type { ChannelAdapter } from "@/lib/channels/adapter";
import type {
  TelegramMessage,
  TelegramUpdate,
} from "@/lib/channels/telegram/types";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

function constantTimeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths; the length check itself is not a
  // timing oracle for the secret value (only its length), matching the /ingest
  // route's established approach.
  return a.length === b.length && timingSafeEqual(a, b);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Extract one raw_inbox row from a message-like field, or null when the message
// carries no capturable content (service messages, stickers we do not model...).
function rowFromMessage(
  msg: TelegramMessage,
  updateId: number,
): Record<string, unknown> | null {
  const text = msg.text ?? msg.caption ?? null;
  const documentFileId = msg.document?.file_id ?? null;
  if (text === null && documentFileId === null) return null;

  return {
    text,
    user_id: msg.from?.id ?? null,
    chat_id: msg.chat?.id ?? null,
    message_id: msg.message_id ?? null,
    update_id: updateId,
    document_file_id: documentFileId,
  };
}

export const telegramAdapter: ChannelAdapter = {
  source: "telegram",

  verifyRequest(req: Request, envSecret: string | undefined): boolean {
    if (!envSecret) return false; // inert when unset
    const provided = req.headers.get(SECRET_HEADER);
    if (!provided) return false;
    return constantTimeEqual(provided, envSecret);
  },

  async parsePayload(body: unknown): Promise<Record<string, unknown>[]> {
    if (!isPlainObject(body) || typeof body.update_id !== "number") {
      throw new Error("invalid telegram update");
    }
    const update = body as unknown as TelegramUpdate;

    const messages: (TelegramMessage | undefined)[] = [
      update.message,
      update.edited_message,
      update.channel_post,
      update.edited_channel_post,
    ];

    const rows: Record<string, unknown>[] = [];
    for (const msg of messages) {
      if (!msg) continue;
      const row = rowFromMessage(msg, update.update_id);
      if (row) rows.push(row);
    }
    return rows;
  },
};
