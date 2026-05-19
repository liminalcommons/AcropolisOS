// M2.2 step-6: pure helper that scans chat messages for an outstanding
// apply_action confirmation envelope.
//
// Decoupled from React and from the exact UIMessage type (which varies
// across ai-sdk minor versions) — accepts any message-like shape with a
// `parts` array. The chat-panel calls this on every message change and
// renders a card via <ActionConfirmationCard/> when non-null.
//
// Detection strategy: parts of type `tool-apply_action` carry the tool's
// output envelope. When envelope.ok === false and confirmation_required is
// present, we surface (toolCallId, envelope). The toolCallId is the
// idempotency anchor — the chat panel tracks dismissals by that id.

export interface ConfirmationEnvelope {
  action: string;
  params: unknown;
  reason: "always_confirm" | "unfamiliar";
  prior_success_count?: number;
  required_permissions: string[];
  description?: string;
}

export interface PendingConfirmation {
  toolCallId: string;
  envelope: ConfirmationEnvelope;
}

// Minimal shape — accept anything with parts. ai-sdk's UIMessage extends
// this interface but the runtime shape is what we actually iterate.
export interface ChatLikeMessagePart {
  type: string;
  toolCallId?: string;
  output?: unknown;
  text?: string;
}

export interface ChatLikeMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: ChatLikeMessagePart[];
}

function isConfirmationEnvelope(value: unknown): value is ConfirmationEnvelope {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  if (typeof e.action !== "string") return false;
  if (!("params" in e)) return false;
  if (typeof e.reason !== "string") return false;
  if (e.reason !== "always_confirm" && e.reason !== "unfamiliar") return false;
  if (!Array.isArray(e.required_permissions)) return false;
  return true;
}

function extractApplyActionConfirmation(
  part: ChatLikeMessagePart,
): ConfirmationEnvelope | null {
  // The part type for an apply_action tool result depends on the ai-sdk
  // protocol variant:
  //   - "tool-apply_action" (UIMessage protocol, name namespaced into type)
  //   - "tool-result" with toolName === "apply_action" (generic form)
  if (part.type !== "tool-apply_action" && part.type !== "tool-result") {
    return null;
  }
  const output = part.output as Record<string, unknown> | undefined;
  if (!output) return null;
  if (output.ok !== false) return null;
  const env = output.confirmation_required;
  if (!isConfirmationEnvelope(env)) return null;
  return env;
}

export function pickPendingConfirmation(
  messages: ChatLikeMessage[],
  dismissedToolCallIds: ReadonlySet<string> = new Set(),
): PendingConfirmation | null {
  // Walk newest-first so the most recent unanswered confirmation wins.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j];
      const envelope = extractApplyActionConfirmation(part);
      if (!envelope) continue;
      const toolCallId = part.toolCallId ?? `${msg.id}:${j}`;
      if (dismissedToolCallIds.has(toolCallId)) continue;
      return { toolCallId, envelope };
    }
  }
  return null;
}
