"use client";

// US-017: Persistent chat panel.
// US-018: Inline proposal panel surface below the message thread.
//
// Right-side dock-collapsible chat surface for vibe ontology coding. Mounted
// in app/layout.tsx so every authenticated route has it. Open/closed state is
// persisted to localStorage via the helpers in chat-panel-state.ts.
//
// Streaming integration: uses `useChat` from `@ai-sdk/react` with the
// `TextStreamChatTransport` because /api/chat returns `toTextStreamResponse()`
// (plain text protocol). Markdown is rendered with react-markdown + remark-gfm
// (code fences, tables, strikethrough). The file drop slot accepts files via
// the native drag-and-drop API and shows their names.
//
// Inline proposal panel (US-018): each chat-panel session is identified by a
// stable client-side UUID stored in localStorage under
// CHAT_SESSION_STORAGE_KEY. The id is sent to /api/chat as `session_id` so the
// agent can pass it to finalize_proposal(); the proposal store associates
// proposals with that session id. After every agent stream completes we poll
// /api/proposals?session_id=<id> and surface the latest pending proposal
// below the message list via <InlineProposalPanel/>.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport, type UIMessage } from "ai";
import { ChevronRight, MessageSquare, Paperclip, Send, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Proposal } from "@/lib/proposals/store";
import type { BuiltInRole } from "@/lib/auth/users";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PANEL_STATE,
  loadPanelState,
  savePanelState,
  subscribePanelState,
} from "./chat-panel-state";
import {
  CHAT_SESSION_STORAGE_KEY,
  pickLatestProposalForSession,
} from "./inline-proposal-panel-state";
import { InlineProposalPanel } from "./inline-proposal-panel";

interface DroppedFile {
  name: string;
  size: number;
}

interface ChatPanelProps {
  actorRole?: BuiltInRole | null;
  actorEmail?: string;
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function getOrCreateChatSessionId(): string {
  if (typeof globalThis === "undefined") return "";
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  if (!storage) return "";
  try {
    const existing = storage.getItem(CHAT_SESSION_STORAGE_KEY);
    if (existing) return existing;
  } catch {
    return "";
  }
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  const fresh = cryptoApi?.randomUUID
    ? cryptoApi.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    storage.setItem(CHAT_SESSION_STORAGE_KEY, fresh);
  } catch {
    // Quota / private-browsing — fall through with the value we already minted.
  }
  return fresh;
}

function chatSessionNoopSubscribe(): () => void {
  return () => {};
}

function serverChatSessionSnapshot(): string {
  return "";
}

export function ChatPanel({
  actorRole = null,
  actorEmail,
}: ChatPanelProps = {}): React.ReactNode {
  const panelState = useSyncExternalStore(
    subscribePanelState,
    loadPanelState,
    () => DEFAULT_PANEL_STATE,
  );
  const [input, setInput] = useState("");
  const [droppedFiles, setDroppedFiles] = useState<DroppedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [dismissedProposals, setDismissedProposals] = useState<Set<string>>(
    () => new Set(),
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stable per-browser chat session id; SSR returns "" to avoid touching
  // localStorage on the server, the client picks up the persisted id on
  // hydration. useSyncExternalStore keeps the setState-in-effect lint happy
  // by sourcing the value via a snapshot callback instead of useEffect.
  const chatSessionId = useSyncExternalStore<string>(
    chatSessionNoopSubscribe,
    getOrCreateChatSessionId,
    serverChatSessionSnapshot,
  );

  const transport = useMemo(() => {
    if (!chatSessionId) {
      return new TextStreamChatTransport({ api: "/api/chat" });
    }
    return new TextStreamChatTransport({
      api: "/api/chat",
      body: { session_id: chatSessionId },
    });
  }, [chatSessionId]);

  const dismissedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    dismissedRef.current = dismissedProposals;
  }, [dismissedProposals]);

  const pollLatestProposal = useCallback(async (): Promise<void> => {
    if (!chatSessionId) return;
    try {
      const res = await fetch(
        `/api/proposals?session_id=${encodeURIComponent(chatSessionId)}`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { proposals: Proposal[] };
      const latest = pickLatestProposalForSession(
        body.proposals,
        chatSessionId,
      );
      if (latest && !dismissedRef.current.has(latest.id)) {
        setActiveProposalId(latest.id);
      }
    } catch {
      // Polling is best-effort; a transient failure is fine.
    }
  }, [chatSessionId]);

  const { messages, sendMessage, status, error } = useChat({
    transport,
    // After the assistant stream finishes the agent may have just called
    // finalize_proposal(). Poll the queue for the freshly minted proposal so
    // the inline panel materializes without the user clicking anything.
    onFinish: () => {
      void pollLatestProposal();
    },
  });

  useEffect(() => {
    if (panelState.open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, panelState.open, activeProposalId]);

  const toggle = () => savePanelState({ open: !panelState.open });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || status !== "ready") return;
    sendMessage({ text });
    setInput("");
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    setDroppedFiles((prev) => [
      ...prev,
      ...files.map((f) => ({ name: f.name, size: f.size })),
    ]);
  };

  const dismissProposal = (id: string): void => {
    setDismissedProposals((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setActiveProposalId((current) => (current === id ? null : current));
  };

  if (!panelState.open) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label="Open chat panel"
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-zinc-100 shadow-lg ring-1 ring-zinc-800 transition hover:bg-zinc-800"
      >
        <MessageSquare className="h-5 w-5" aria-hidden />
      </button>
    );
  }

  return (
    <aside
      aria-label="Chat panel"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl"
    >
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="h-4 w-4 text-zinc-400" aria-hidden />
          <span>chat</span>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label="Collapse chat panel"
          className="rounded p-1 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3"
        data-testid="chat-panel-scroll"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-zinc-500">
            Ask anything about your ontology. Drag files into the drop zone to
            attach context.
          </p>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => {
              const text = getMessageText(m);
              const isUser = m.role === "user";
              return (
                <li
                  key={m.id}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm",
                    isUser
                      ? "bg-zinc-800 text-zinc-50"
                      : "bg-zinc-900 text-zinc-100 ring-1 ring-zinc-800",
                  )}
                >
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                    {isUser ? "you" : "agent"}
                  </div>
                  <div className="prose prose-invert prose-sm max-w-none break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {text}
                    </ReactMarkdown>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {activeProposalId ? (
          <div className="mt-3" data-testid="chat-panel-proposal-slot">
            <InlineProposalPanel
              key={activeProposalId}
              proposalId={activeProposalId}
              actorRole={actorRole}
              actorEmail={actorEmail}
              onDismiss={() => dismissProposal(activeProposalId)}
            />
          </div>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-md bg-red-950/40 px-3 py-2 text-xs text-red-300 ring-1 ring-red-900">
            {error.message}
          </p>
        ) : null}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "mx-4 mb-2 flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs transition",
          isDragOver
            ? "border-zinc-400 bg-zinc-900 text-zinc-200"
            : "border-zinc-800 text-zinc-500",
        )}
        data-testid="chat-panel-drop"
      >
        <Paperclip className="h-3.5 w-3.5" aria-hidden />
        {droppedFiles.length === 0 ? (
          <span>drop files here to attach</span>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {droppedFiles.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-zinc-200"
              >
                <span className="max-w-[140px] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setDroppedFiles((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  aria-label={`Remove ${f.name}`}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={submit}
        className="flex items-end gap-2 border-t border-zinc-800 px-4 py-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          placeholder="ask the agent…"
          rows={2}
          disabled={status !== "ready"}
          className="flex-1 resize-none rounded-md bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 ring-1 ring-zinc-800 focus:outline-none focus:ring-zinc-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status !== "ready" || input.trim().length === 0}
          aria-label="Send message"
          className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-900 transition hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </aside>
  );
}
