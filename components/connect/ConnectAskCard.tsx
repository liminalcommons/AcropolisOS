"use client";

// F2-step1: ConnectAskCard — violet "ask the agent" card.
//
// Chat input that navigates to /dashboard/ask with the message pre-filled
// as a query param. No form POST — it's a Link with dynamic href so the
// existing F6 chat overlay handles the conversation.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ConnectAskCard() {
  const [message, setMessage] = useState("");
  const router = useRouter();

  function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) return;
    router.push(`/dashboard/ask?prefill=${encodeURIComponent(trimmed)}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSend();
  }

  return (
    <div className="rounded-lg border border-dashed border-violet-700/60 bg-violet-500/[0.04] p-5 space-y-4">
      <div>
        <p className="text-sm font-medium text-violet-200">
          Ask the agent what to connect
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          e.g. &quot;pull my Hostelworld bookings every morning&quot;
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tell the agent what to connect…"
          className="flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/40 transition-colors"
        />
        <button
          onClick={handleSend}
          disabled={!message.trim()}
          aria-label="Send"
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          →
        </button>
      </div>
    </div>
  );
}
