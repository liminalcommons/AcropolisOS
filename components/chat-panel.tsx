"use client";

// US-017: Persistent chat panel.
// US-018: Inline proposal panel surface below the message thread.
//
// Right-side dock-collapsible chat surface for vibe ontology coding. Mounted
// in app/layout.tsx so every authenticated route has it. Open/closed state is
// persisted to localStorage via the helpers in chat-panel-state.ts.
//
// Streaming integration: uses `useChat` from `@ai-sdk/react` with the
// `DefaultChatTransport` (UI message stream protocol — SSE). /api/chat now
// returns `toUIMessageStreamResponse()` so tool result envelopes
// (apply_action confirmation_required, audit_id, propose_* outputs) land as
// structured message parts on `useChat({messages})` and the inline
// ActionConfirmationCard / InlineProposalPanel can detect them.
// Markdown is rendered with react-markdown + remark-gfm (code fences, tables,
// strikethrough). The file drop slot accepts files via the native
// drag-and-drop API and shows their names.
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
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { Inbox, MessageSquare, Paperclip, Send, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Proposal } from "@/lib/proposals/store";
import type { BuiltInRole } from "@/lib/auth/users";
import { cn } from "@/lib/utils";
import {
  CHAT_SESSION_STORAGE_KEY,
  pickLatestProposalForSession,
} from "./inline-proposal-panel-state";
import { InlineProposalPanel } from "./inline-proposal-panel";
// M2.2 step-6: inline confirmation card for policy-gated apply_action.
import { ActionConfirmationCard } from "./chat/action-confirmation-card";
import {
  pickPendingConfirmation,
  type ChatLikeMessage,
} from "./chat/action-confirmation-state";

interface DroppedFile {
  name: string;
  size: number;
  inboxIds?: string[];
}

interface ChatPanelProps {
  actorRole?: BuiltInRole | null;
  actorEmail?: string;
  modelName?: string;
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
  modelName,
}: ChatPanelProps = {}): React.ReactNode {
  const [input, setInput] = useState("");
  const [droppedFiles, setDroppedFiles] = useState<DroppedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [dismissedProposals, setDismissedProposals] = useState<Set<string>>(
    () => new Set(),
  );
  // M2.2 step-6: track confirmations the user explicitly dismissed so they
  // don't re-render after subsequent message updates. Keyed by toolCallId.
  const [dismissedConfirmations, setDismissedConfirmations] = useState<
    Set<string>
  >(() => new Set());
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
      return new DefaultChatTransport({ api: "/api/chat" });
    }
    return new DefaultChatTransport({
      api: "/api/chat",
      body: { session_id: chatSessionId },
    });
  }, [chatSessionId]);

  const dismissedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    dismissedRef.current = dismissedProposals;
  }, [dismissedProposals]);

  // S4 · Track which proposal we've already broadcast so the mutation
  // CustomEvent fires once per unique proposal id, even though the poll
  // runs after every stream.
  const lastBroadcastIdRef = useRef<string | null>(null);

  // Home → chat prompt staging. PromptButton dispatches `acropolisos:prompt`
  // when a CTA / suggestion chip is clicked. We populate the textarea and
  // focus it so the user can review/edit before sending.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const handler = (e: Event): void => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      if (!prompt) return;
      setInput(prompt);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(prompt.length, prompt.length);
        }
      });
    };
    window.addEventListener("acropolisos:prompt", handler);
    return () => window.removeEventListener("acropolisos:prompt", handler);
  }, []);

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
        // S4 · Broadcast which object types this proposal touches so home
        // type cards can pulse for 3s. Sources: keys of new_object_types
        // (additions) + impacted_tables (mutations on existing tables).
        if (
          typeof window !== "undefined" &&
          lastBroadcastIdRef.current !== latest.id
        ) {
          lastBroadcastIdRef.current = latest.id;
          const newKeys = Object.keys(latest.diff.new_object_types ?? {});
          const impacted = Array.isArray(latest.diff.impacted_tables)
            ? latest.diff.impacted_tables
            : [];
          const types = Array.from(new Set([...newKeys, ...impacted]));
          if (types.length > 0) {
            window.dispatchEvent(
              new CustomEvent("acropolisos:mutation", { detail: { types } }),
            );
          }
        }
        setActiveProposalId(latest.id);
      }
    } catch {
      // Polling is best-effort; a transient failure is fine.
    }
  }, [chatSessionId]);

  // M4.1 step-6: live unread inbox count for the header badge. Polled
  // every 15s so a notify_member side-effect on another tab surfaces here
  // without a manual refresh. The /api/notifications/unread-count handler
  // returns 0 for anon sessions so this never throws.
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const fetchCount = async (): Promise<void> => {
      try {
        const res = await fetch("/api/notifications/unread-count", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as { count?: number };
        if (!cancelled && typeof body.count === "number") {
          setUnreadCount(body.count);
        }
      } catch {
        // best-effort; transient failures shouldn't poison the chat UI
      }
    };
    void fetchCount();
    const id = setInterval(() => void fetchCount(), 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeProposalId]);

  // S2 · Expand-on-stream. While the agent is processing (status === submitted
  // or streaming) the strip grows to min(30vh, 320px) so messages become
  // visible. 3s after status returns to "ready" it collapses back to h-11.
  const [expanded, setExpanded] = useState(false);
  const streaming = status !== "ready";
  useEffect(() => {
    if (streaming) {
      setExpanded(true);
      return;
    }
    const id = setTimeout(() => setExpanded(false), 3000);
    return () => clearTimeout(id);
  }, [streaming]);

  // Broadcast useChat status so the global TopProgressBar can show/hide.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("acropolisos:chat-status", { detail: { status } }),
    );
  }, [status]);

  // Track elapsed ms from submit → ready; renders as "N.Ns" in the
  // thinking-strip header.
  const [thinkingStartMs, setThinkingStartMs] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (streaming) {
      if (thinkingStartMs === null) {
        setThinkingStartMs(Date.now());
        setElapsedMs(0);
      }
    } else {
      setThinkingStartMs(null);
    }
  }, [streaming, thinkingStartMs]);
  useEffect(() => {
    if (thinkingStartMs === null) return;
    const id = setInterval(() => {
      setElapsedMs(Date.now() - thinkingStartMs);
    }, 100);
    return () => clearInterval(id);
  }, [thinkingStartMs]);

  // `chatSessionId` hydrates from localStorage AFTER the first render. If a
  // prompt is staged + submitted (e.g. PromptButton + dispatch +
  // auto-click) before hydration completes, the transport ships without
  // body.session_id and the proposal lands with an anon session id that
  // the inline-panel poll can never match. We mark the submit as pending
  // and flush it from a useEffect when chatSessionId becomes available.
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || status !== "ready") return;
    if (!chatSessionId) {
      setPendingSubmit(true);
      return;
    }
    sendMessage({ text });
    setInput("");
  };
  useEffect(() => {
    if (!pendingSubmit) return;
    if (!chatSessionId || status !== "ready") return;
    const text = input.trim();
    if (!text) {
      setPendingSubmit(false);
      return;
    }
    setPendingSubmit(false);
    sendMessage({ text });
    setInput("");
  }, [chatSessionId, status, pendingSubmit, input, sendMessage]);

  const uploadFiles = useCallback(async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    setUploadPending(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/inbox/upload", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as {
        inboxIds?: string[];
        count?: number;
        error?: string;
      };
      if (!res.ok) {
        setUploadError(body.error ?? `upload failed (${res.status})`);
        return;
      }
      const inboxIds = body.inboxIds ?? [];
      const rowCount = body.count ?? files.length;
      setDroppedFiles((prev) => [
        ...prev,
        ...files.map((f, i) => ({
          name: f.name,
          size: f.size,
          inboxIds: i === 0 ? inboxIds : [],
        })),
      ]);
      // Fire a cue so the agent picks up the upload immediately.
      const fileNames = files.map((f) => f.name).join(", ");
      const cue = `I just dropped ${files.length > 1 ? "files" : "a file"} (${fileNames}) with ${rowCount} row${rowCount === 1 ? "" : "s"} into the inbox. Inbox row ids: ${inboxIds.slice(0, 5).join(", ")}${inboxIds.length > 5 ? ` … and ${inboxIds.length - 5} more` : ""}. Please sample_inbox to inspect the payload, identify the best target object type, and call propose_ingest with the field mapping. Then finalize_proposal.`;
      window.dispatchEvent(
        new CustomEvent("acropolisos:prompt", { detail: { prompt: cue } }),
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploadPending(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    void uploadFiles(files);
  }, [uploadFiles]);

  const dismissProposal = (id: string): void => {
    setDismissedProposals((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setActiveProposalId((current) => (current === id ? null : current));
  };

  // S1 · Bottom chat strip. Aside is fixed to the viewport bottom at h-11
  // (44px) idle. The input form is absolutely positioned to the bottom 44px
  // so it's always visible regardless of the aside's height. The history
  // pane sits above the form (bottom-11) and is clipped while the aside is
  // h-11; S2 will grow the aside (`min(30vh, 320px)`) when the agent is
  // streaming so the history pane becomes visible. Layout.tsx pads body
  // with pb-11 so page content never sits under the strip.
  return (
    <aside
      aria-label="Chat panel"
      data-state={expanded ? "expanded" : "idle"}
      className={cn(
        "fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 overflow-hidden rounded-2xl border border-zinc-800/70 bg-zinc-950/50 text-zinc-100 shadow-2xl backdrop-blur-md transition-[height] duration-200 ease-out md:bottom-6 md:w-[70%]",
        expanded ? "h-[min(30vh,320px)]" : "h-11",
      )}
    >
      <div className="absolute inset-x-0 top-0 bottom-11 flex flex-col">
        <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2 text-sm font-medium">
          {streaming ? (
            <>
              <span
                className="inline-block h-2 w-2 rounded-full bg-violet-400"
                style={{ animation: "acro-pulse 1.4s ease-in-out infinite" }}
                aria-hidden
              />
              <span className="text-xs uppercase tracking-widest text-violet-300">
                agent {status === "submitted" ? "thinking" : "working"}
              </span>
              <span className="ml-auto font-mono text-[10px] text-zinc-500">
                {modelName ? `${modelName} · ` : ""}
                {(elapsedMs / 1000).toFixed(1)}s
              </span>
            </>
          ) : (
            <>
              <MessageSquare className="h-4 w-4 text-zinc-400" aria-hidden />
              <span>chat</span>
              <span className="ml-auto flex items-center gap-3">
                <Link
                  href="/inbox"
                  data-testid="chat-panel-inbox-link"
                  aria-label={
                    unreadCount > 0
                      ? `Inbox (${unreadCount} unread)`
                      : "Inbox"
                  }
                  className="relative inline-flex items-center text-zinc-400 hover:text-zinc-200"
                >
                  <Inbox className="h-4 w-4" aria-hidden />
                  {unreadCount > 0 ? (
                    <span
                      data-testid="chat-panel-inbox-badge"
                      className="absolute -right-2 -top-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-violet-500 px-1 font-mono text-[9px] font-semibold leading-none text-zinc-50"
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </Link>
                <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                  always on
                </span>
              </span>
            </>
          )}
        </header>
        <style>{`
          @keyframes acro-pulse {
            0%, 100% { opacity: 0.5; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.15); }
          }
          @keyframes acro-cursor-blink { 50% { opacity: 0; } }
          .acro-stream-cursor {
            display: inline-block;
            width: 0.5em;
            height: 1em;
            background: #a78bfa;
            margin-left: 2px;
            vertical-align: text-bottom;
            animation: acro-cursor-blink 1s steps(2) infinite;
          }
        `}</style>

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
            {messages.map((m, idx) => {
              const text = getMessageText(m);
              const isUser = m.role === "user";
              const isLast = idx === messages.length - 1;
              const showCursor = !isUser && isLast && streaming;
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
                    {showCursor ? (
                      <span className="acro-stream-cursor" aria-hidden />
                    ) : null}
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
        {(() => {
          // M2.2 step-6: render confirmation card if the latest tool output
          // surfaced a confirmation_required envelope.
          // M3.8 #35: Confirm POSTs directly to /api/chat/confirm (server
          // sets bypassConfirmation=true). We no longer inject a text cue
          // into the LLM stream — that path allowed prompt injection to
          // induce a bypass. Cancel only dismisses the card.
          const pending = pickPendingConfirmation(
            messages as unknown as ChatLikeMessage[],
            dismissedConfirmations,
          );
          if (!pending) return null;
          return (
            <div className="mt-3" data-testid="chat-panel-confirmation-slot">
              <ActionConfirmationCard
                toolCallId={pending.toolCallId}
                envelope={pending.envelope}
                onConfirm={({ action, params, toolCallId }) => {
                  setDismissedConfirmations((prev) => {
                    const next = new Set(prev);
                    next.add(toolCallId);
                    return next;
                  });
                  // M3.8 #35: POST directly to server — bypass flag is set
                  // server-side only, never via LLM tool args.
                  void fetch("/api/chat/confirm", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action, params }),
                  });
                }}
                onCancel={(toolCallId) => {
                  setDismissedConfirmations((prev) => {
                    const next = new Set(prev);
                    next.add(toolCallId);
                    return next;
                  });
                }}
              />
            </div>
          );
        })()}
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
          uploadError
            ? "border-red-700 bg-red-950/30 text-red-300"
            : isDragOver
              ? "border-zinc-400 bg-zinc-900 text-zinc-200"
              : "border-zinc-800 text-zinc-500",
        )}
        data-testid="chat-panel-drop"
      >
        <Paperclip className="h-3.5 w-3.5" aria-hidden />
        {uploadPending ? (
          <span className="animate-pulse">uploading to inbox…</span>
        ) : uploadError ? (
          <span className="truncate">{uploadError}</span>
        ) : droppedFiles.length === 0 ? (
          <span>drop CSV / JSON here → agent proposes ingest</span>
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

      </div>

      {expanded ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-11 z-10 border-t border-zinc-800/50 bg-zinc-950/85 px-4 py-1 text-[10px] text-zinc-500 backdrop-blur">
          <span className="font-mono text-zinc-400">↵</span> to send ·{" "}
          <span className="font-mono text-zinc-400">shift+↵</span> for newline ·{" "}
          <span className="font-mono text-zinc-400">esc</span> to clear
        </div>
      ) : null}

      <form
        onSubmit={submit}
        className="absolute inset-x-0 bottom-0 flex h-11 items-center gap-2 border-t border-zinc-800 bg-zinc-950/90 px-4"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            } else if (e.key === "Escape") {
              setInput("");
              (e.currentTarget as HTMLTextAreaElement).blur();
            }
          }}
          placeholder={
            !chatSessionId
              ? "loading session…"
              : streaming
                ? "agent is responding…"
                : "ask the agent…"
          }
          rows={1}
          disabled={status !== "ready" || !chatSessionId}
          className="flex-1 resize-none rounded-md bg-zinc-900 px-3 py-1.5 text-sm leading-tight text-zinc-100 placeholder-zinc-500 ring-1 ring-zinc-800 focus:outline-none focus:ring-zinc-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={
            status !== "ready" ||
            input.trim().length === 0 ||
            !chatSessionId
          }
          aria-label="Send message"
          className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-100 text-zinc-900 transition hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </aside>
  );
}
