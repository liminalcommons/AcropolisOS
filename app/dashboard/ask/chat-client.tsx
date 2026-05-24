// F6: AskAgentChat — client component for /dashboard/ask.
//
// Uses useChat (ai-sdk v6 React hook) with DefaultChatTransport against /api/chat.
// Parses agent responses for JSON code fences containing widget proposals:
//   ```json
//   { "kind": "table", "title": "...", "props": { "rows": [...] } }
//   ```
// When found, renders a preview card + "Pin to dashboard" button that calls
// the pinWidget server action.

"use client";

import { useState, useCallback, useTransition } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { pinWidget } from "./actions";

// Minimal subset we parse from agent widget proposals.
interface WidgetProposal {
  kind: string;
  title: string;
  props: Record<string, unknown>;
}

// Extract text content from a UIMessage (ai-sdk v6 parts-based format).
function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// Extract the first JSON code fence from a text response and try to parse it
// as a widget proposal. Returns null if no valid proposal found.
function extractWidgetProposal(text: string): WidgetProposal | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    // Strip leading `> ` markdown blockquote markers (agent sometimes wraps
    // code fences in a blockquote block).
    const cleaned = match[1]
      .split("\n")
      .map((line) => line.replace(/^>\s?/, ""))
      .join("\n")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.kind === "string" &&
      typeof parsed.title === "string"
    ) {
      return {
        kind: parsed.kind as string,
        title: parsed.title as string,
        props:
          parsed.props && typeof parsed.props === "object"
            ? (parsed.props as Record<string, unknown>)
            : {},
      };
    }
  } catch {
    // not valid JSON
  }
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

// Transport is stable across renders (useMemo equivalent via module-level constant).
const transport = new DefaultChatTransport({ api: "/api/chat" });

export function AskAgentChat() {
  const { messages, sendMessage, status } = useChat({ transport });

  const [inputValue, setInputValue] = useState("");
  const [isPinning, startPinTransition] = useTransition();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = inputValue.trim();
      if (!text || status === "streaming" || status === "submitted") return;
      sendMessage({ text });
      setInputValue("");
    },
    [inputValue, status, sendMessage],
  );

  const handlePin = useCallback((proposal: WidgetProposal) => {
    startPinTransition(async () => {
      await pinWidget({
        id: "",          // server action assigns a fresh UUID
        kind: proposal.kind,
        title: proposal.title,
        props: proposal.props,
      });
      // pinWidget() calls redirect("/") server-side.
    });
  }, []);

  const isLoading = status === "streaming" || status === "submitted";

  return (
    <div className="flex flex-col flex-1 gap-4">
      {/* Conversation */}
      <div className="flex-1 space-y-4">
        {messages.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center">
            <p className="text-sm text-zinc-500">
              Ask for a widget, e.g.{" "}
              <span className="text-zinc-400 italic">
                &ldquo;show me which beds need cleaning tomorrow morning&rdquo;
              </span>{" "}
              or{" "}
              <span className="text-zinc-400 italic">
                &ldquo;give me a list of guests checking out today&rdquo;
              </span>
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const textContent = getMessageText(msg);
          const proposal = !isUser && textContent ? extractWidgetProposal(textContent) : null;

          return (
            <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-4 py-3 text-sm ${
                  isUser
                    ? "bg-zinc-800 text-zinc-100"
                    : "bg-zinc-900 border border-zinc-800 text-zinc-200"
                }`}
              >
                <div className="whitespace-pre-wrap">{textContent}</div>

                {/* Widget proposal preview + pin button */}
                {proposal && (
                  <div className="mt-4 border border-zinc-700 rounded-lg p-3 bg-zinc-950/50">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
                      Widget proposal
                    </p>
                    <p className="text-xs font-medium text-zinc-200 mb-1">
                      {proposal.title}
                    </p>
                    <p className="text-[11px] text-zinc-500 mb-3">
                      kind:{" "}
                      <span className="font-mono text-zinc-400">
                        {proposal.kind}
                      </span>
                    </p>
                    <button
                      type="button"
                      disabled={isPinning}
                      onClick={() => handlePin(proposal)}
                      className="rounded-md bg-emerald-700 px-4 py-1.5 text-xs font-medium text-zinc-50 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isPinning ? "Pinning…" : "Pin to dashboard"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-3 bg-zinc-900 border border-zinc-800">
              <span className="text-xs text-zinc-500 animate-pulse">
                Agent is thinking…
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 pt-4 border-t border-zinc-800 sticky bottom-0 bg-zinc-950 pb-4"
      >
        <input
          name="prompt"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Describe the widget you want…"
          disabled={isLoading}
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || !inputValue.trim()}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
