"use client";

// F4: ClientNarrator — streams agent narration from /api/organize/classify.
// On mount, POSTs the raw rows to the classify endpoint and renders the
// streaming response as typewriter text (one character at a time via Reader API).

import { useState, useEffect, useRef } from "react";
import type { RawInboxRow } from "@/lib/db/schema";

interface ClientNarratorProps {
  initialRows: RawInboxRow[];
}

export function ClientNarrator({ initialRows }: ClientNarratorProps) {
  const [text, setText] = useState<string>("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function stream() {
      try {
        const res = await fetch("/api/organize/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: initialRows }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          setError(`Agent returned ${res.status}${body ? ": " + body : ""}`);
          setDone(true);
          return;
        }

        if (!res.body) {
          setError("No response body — streaming not supported.");
          setDone(true);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        // toTextStreamResponse() emits raw UTF-8 text deltas — just append.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done: readerDone, value } = await reader.read();
          if (readerDone) break;
          const chunk = decoder.decode(value, { stream: true });
          setText((prev) => prev + chunk);
        }

        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setDone(true);
      }
    }

    stream();
  }, [initialRows]);

  return (
    <div className="space-y-6">
      {/* Narration panel */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-5">
        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">
          Agent narration
        </p>
        {error ? (
          <p className="text-sm text-red-400 font-mono">{error}</p>
        ) : (
          <pre className="text-sm text-zinc-200 font-mono leading-relaxed whitespace-pre-wrap break-words">
            {text || (
              <span className="text-zinc-600 animate-pulse">Reading rows…</span>
            )}
            {!done && text && (
              <span className="inline-block w-1.5 h-4 bg-zinc-400 animate-pulse ml-0.5 translate-y-0.5" />
            )}
          </pre>
        )}
      </div>

      {/* Apply placeholder */}
      {done && !error && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled
            className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-5 py-2.5 text-sm font-medium text-zinc-500 cursor-not-allowed"
          >
            Apply proposal (coming soon)
          </button>
          <p className="text-xs text-zinc-600">
            Apply will create typed objects from the proposal in the next cycle.
          </p>
        </div>
      )}
    </div>
  );
}
