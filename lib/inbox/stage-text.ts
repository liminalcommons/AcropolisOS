// Pure builder for a chat-pasted raw_inbox row. The agent's `ingest_text` tool
// stages free-text data (a pasted list/dump) into raw_inbox so /organize + the
// GROW loop can classify and grow it — the storyboard's "paste your mess in
// chat" intake channel. Pure shape only (no db); the chat route does the insert
// via db.insert(raw_inbox).values(chatPasteRow(...)).
export interface RawInboxInsert {
  source: string;
  payload: Record<string, unknown>;
}

export const CHAT_PASTE_SOURCE = "chat-paste";

export function chatPasteRow(text: string, label?: string): RawInboxInsert {
  const trimmed = text.trim();
  const cleanLabel = label?.trim();
  return {
    source: CHAT_PASTE_SOURCE,
    payload: cleanLabel ? { text: trimmed, label: cleanLabel } : { text: trimmed },
  };
}
