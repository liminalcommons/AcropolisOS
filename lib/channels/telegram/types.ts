// lib/channels/telegram/types.ts
//
// Minimal Telegram Bot API "Update" shape — only the fields the inbound adapter
// reads. We deliberately do NOT model the full Telegram API: an Update has many
// optional fields, but inbound message capture needs the message-like members
// (message / edited_message / channel_post / edited_channel_post) and, within
// each, the text/caption/document and the from/chat/message_id identity fields.
//
// All message-like fields are optional: a single Update carries exactly one of
// them in practice, but the type allows any subset.

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string; // "private" | "group" | "supergroup" | "channel"
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser; // absent for channel posts
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  document?: TelegramDocument;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

// A realistic text-message Update, shared by the adapter tests and the route
// integration test (task 7) so the fixture lives in one place.
export const SAMPLE_UPDATE: TelegramUpdate = {
  update_id: 870123456,
  message: {
    message_id: 4521,
    from: { id: 1234567, is_bot: false, first_name: "Lin", username: "lin_h" },
    chat: { id: -1002233445566, type: "supergroup" },
    date: 1_717_200_000,
    text: "Can someone bring extra blankets to dorm 3 tonight?",
  },
};
