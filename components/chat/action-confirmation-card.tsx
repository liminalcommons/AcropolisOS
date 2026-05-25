"use client";

// M2.2 step-6: confirmation card for apply_action policy-gated calls.
//
// Rendered inline in the chat panel when pickPendingConfirmation() finds a
// confirmation envelope. The user sees the action name + parameters + a
// Confirm/Cancel pair. Confirm dispatches an `acropolisos:apply-bypass`
// CustomEvent carrying the original action + params + the toolCallId; the
// chat panel listens for that event and re-sends a user message that the
// agent translates into a second apply_action call with bypass_confirmation.
//
// We use a CustomEvent (not a direct refire of the tool) because the chat
// panel owns the useChat transport — adding a side-channel keeps this
// component presentational and trivially testable.

import { useMemo } from "react";
import type { ConfirmationEnvelope } from "./action-confirmation-state";

export interface ActionConfirmationCardProps {
  toolCallId: string;
  envelope: ConfirmationEnvelope;
  onConfirm: (input: {
    toolCallId: string;
    action: string;
    params: unknown;
  }) => void;
  onCancel: (toolCallId: string) => void;
}

function formatParams(params: unknown): string {
  try {
    return JSON.stringify(params, null, 2);
  } catch {
    return String(params);
  }
}

export function ActionConfirmationCard(
  props: ActionConfirmationCardProps,
): React.ReactElement {
  const { toolCallId, envelope, onConfirm, onCancel } = props;

  const paramsBlock = useMemo(() => formatParams(envelope.params), [envelope.params]);

  return (
    <div
      role="region"
      aria-label="Action confirmation required"
      data-testid="action-confirmation-card"
      data-tool-call-id={toolCallId}
      className="my-2 rounded-md border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <div className="font-semibold">Confirm action: {envelope.action}</div>
      {envelope.description ? (
        <div className="mt-1 text-xs opacity-80">{envelope.description}</div>
      ) : null}
      <div className="mt-1 text-xs opacity-80">
        Reason: <span className="font-mono">{envelope.reason}</span>
        {typeof envelope.prior_success_count === "number" ? (
          <span> · {envelope.prior_success_count} prior successes</span>
        ) : null}
      </div>
      <pre className="mt-2 overflow-x-auto rounded bg-amber-100 p-2 text-xs dark:bg-amber-900/30">
        {paramsBlock}
      </pre>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() =>
            onConfirm({
              toolCallId,
              action: envelope.action,
              params: envelope.params,
            })
          }
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => onCancel(toolCallId)}
          className="rounded-md border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:text-amber-200 dark:hover:bg-amber-900/40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
