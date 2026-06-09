"use client";

// US-018: Inline proposal panel rendered below the chat thread.
//
// When the chat agent calls finalize_proposal() during a session, this panel
// fetches the freshly minted proposal payload and renders a structured diff
// (new object types, link types, shared properties, modified properties,
// action types, plus counts for functions/views/seeds/ingests and impacted
// tables). The actor's role determines the action buttons:
//
//   steward → Apply / Edit / Reject
//             Apply  → POST /api/proposals/[id]/apply  (US-020 pipeline)
//             Edit   → opens the dedicated review surface for inline YAML edit
//             Reject → POST /api/proposals/[id]/reject
//   member  → Submit for review
//             POST /api/proposals/[id]/submit-for-review
//             (proposal stays pending and is dispatched to stewards via notify)
//
// Diff summarization is delegated to inline-proposal-panel-state.ts so it can
// be exercised by vitest under environment: node without React DOM.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, Loader2, Send, X } from "lucide-react";
import type { Proposal } from "@/lib/proposals/store";
import type { BuiltInRole } from "@/lib/auth/users";
import {
  proposalAvailableActions,
  summarizeProposalDiff,
  type ProposalAction,
  type ProposalDiffSummary,
} from "./inline-proposal-panel-state";

interface InlineProposalPanelProps {
  proposalId: string;
  actorRole: BuiltInRole | null;
  actorEmail?: string;
  onDismiss?: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; proposal: Proposal; summary: ProposalDiffSummary };

type ButtonState = "idle" | "pending" | "done" | "error";

interface ActionState {
  state: ButtonState;
  error?: string;
}

const INITIAL_ACTION: ActionState = { state: "idle" };

export function InlineProposalPanel({
  proposalId,
  actorRole,
  actorEmail,
  onDismiss,
}: InlineProposalPanelProps): React.ReactElement {
  // The parent (chat-panel) keys this component on proposalId, so a new
  // proposalId remounts the component — initial state is always "loading"
  // and we never need to reset it inside an effect.
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [action, setAction] = useState<ActionState>(INITIAL_ACTION);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/proposals/${proposalId}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`proposal fetch failed (${res.status})`);
        }
        const body = (await res.json()) as { proposal: Proposal };
        if (cancelled) return;
        setLoad({
          kind: "ready",
          proposal: body.proposal,
          summary: summarizeProposalDiff(body.proposal.diff),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "fetch failed";
        setLoad({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  const runAction = (kind: ProposalAction): void => {
    if (action.state === "pending" || action.state === "done") return;
    setAction({ state: "pending" });
    const init: RequestInit = (() => {
      if (kind === "submit-for-review" && actorEmail) {
        return {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ submitted_by: actorEmail }),
        };
      }
      return { method: "POST" };
    })();
    const path = (() => {
      switch (kind) {
        case "apply":
          return "apply";
        case "reject":
          return "reject";
        case "submit-for-review":
          return "submit-for-review";
        default:
          throw new Error(`unsupported action: ${kind}`);
      }
    })();
    fetch(`/api/proposals/${proposalId}/${path}`, init)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(`${kind} failed (${res.status}): ${body.error ?? ""}`);
        }
        setAction({ state: "done" });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "action failed";
        setAction({ state: "error", error: message });
      });
  };

  if (load.kind === "loading") {
    return (
      <div
        data-testid="inline-proposal-loading"
        className="mx-2 mb-3 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        loading proposal {proposalId.slice(0, 8)}…
      </div>
    );
  }

  if (load.kind === "error") {
    return (
      <div
        data-testid="inline-proposal-error"
        className="mx-2 mb-3 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive"
      >
        could not load proposal: {load.message}
      </div>
    );
  }

  const { proposal, summary } = load;
  const actions = proposalAvailableActions(actorRole);
  const wasApplied = action.state === "done" && actions.includes("apply");
  const wasRejected = action.state === "done" && actions.includes("reject");
  const wasSubmitted =
    action.state === "done" && actions.includes("submit-for-review");

  return (
    <section
      data-testid="inline-proposal-panel"
      data-proposal-id={proposal.id}
      className="mx-2 mb-3 overflow-hidden rounded-lg border border-emerald-900 bg-card/60 text-xs text-foreground shadow-inner"
    >
      <header className="flex items-center justify-between border-b border-border bg-background px-3 py-2">
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-emerald-200">
            proposal
          </span>
          <span className="text-muted-foreground">{proposal.id.slice(0, 8)}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{proposal.status}</span>
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss proposal"
            className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </header>

      <div className="space-y-2 px-3 py-3">
        {summary.isEmpty ? (
          <p className="text-muted-foreground">
            (this proposal is empty — no schema deltas were staged)
          </p>
        ) : (
          <ul className="space-y-1.5">
            {summary.new_object_types.length > 0 ? (
              <li>
                <DiffRow
                  label="new object types"
                  items={summary.new_object_types}
                  testid="diff-new-object-types"
                />
              </li>
            ) : null}
            {summary.new_link_types.length > 0 ? (
              <li>
                <DiffRow
                  label="new link types"
                  items={summary.new_link_types}
                  testid="diff-new-link-types"
                />
              </li>
            ) : null}
            {summary.new_shared_properties.length > 0 ? (
              <li>
                <DiffRow
                  label="new shared properties"
                  items={summary.new_shared_properties}
                  testid="diff-new-shared-properties"
                />
              </li>
            ) : null}
            {summary.modified_properties.length > 0 ? (
              <li>
                <DiffRow
                  label="modified properties"
                  items={summary.modified_properties}
                  testid="diff-modified-properties"
                />
              </li>
            ) : null}
            {summary.new_action_types.length > 0 ? (
              <li>
                <DiffRow
                  label="new actions"
                  items={summary.new_action_types}
                  testid="diff-new-action-types"
                />
              </li>
            ) : null}
            {summary.impacted_tables.length > 0 ? (
              <li>
                <DiffRow
                  label="impacted tables"
                  items={summary.impacted_tables}
                  testid="diff-impacted-tables"
                />
              </li>
            ) : null}
            <li className="flex flex-wrap gap-2 pt-1 text-muted-foreground">
              <Tally label="functions" n={summary.function_count} />
              <Tally label="views" n={summary.view_count} />
              <Tally label="seeds" n={summary.seed_count} />
              <Tally label="ingests" n={summary.ingest_count} />
            </li>
          </ul>
        )}
        {summary.evidenceByField.length > 0 ? (
          <section
            data-testid="diff-evidence"
            className="space-y-1.5 border-t border-border pt-2"
          >
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              receipts
            </p>
            {summary.evidenceByField.map(({ key, rows }) => (
              <details
                key={key}
                className="rounded-md border border-border bg-card px-2 py-1.5"
              >
                <summary className="cursor-pointer text-foreground">
                  <span className="font-medium">{key}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    — proposed because of {rows.length} row
                    {rows.length === 1 ? "" : "s"} you dropped
                  </span>
                </summary>
                <ul className="mt-1.5 space-y-0.5 pl-2 text-muted-foreground">
                  {rows.map((ref) => (
                    <li key={ref} className="font-mono text-[11px]">
                      {ref}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/40 px-3 py-2">
        {action.state === "error" && action.error ? (
          <span className="mr-auto text-destructive">{action.error}</span>
        ) : null}
        {actions.length === 0 ? (
          <span className="mr-auto text-muted-foreground">sign in to act on this proposal</span>
        ) : null}
        {actions.includes("apply") ? (
          <button
            type="button"
            onClick={() => runAction("apply")}
            disabled={action.state === "pending" || action.state === "done"}
            data-testid="inline-proposal-apply"
            className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-emerald-50 hover:bg-emerald-600 disabled:opacity-50"
          >
            {wasApplied ? <Check className="h-3 w-3" aria-hidden /> : null}
            {wasApplied ? "Applied" : "Apply"}
          </button>
        ) : null}
        {actions.includes("edit") ? (
          <Link
            href={`/proposals/${proposal.id}`}
            data-testid="inline-proposal-edit"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-foreground hover:bg-card"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            Edit
          </Link>
        ) : null}
        {actions.includes("reject") ? (
          <button
            type="button"
            onClick={() => runAction("reject")}
            disabled={action.state === "pending" || action.state === "done"}
            data-testid="inline-proposal-reject"
            className="inline-flex items-center gap-1 rounded-md border border-destructive/60 px-2.5 py-1 text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {wasRejected ? "Rejected" : "Reject"}
          </button>
        ) : null}
        {actions.includes("submit-for-review") ? (
          <button
            type="button"
            onClick={() => runAction("submit-for-review")}
            disabled={action.state === "pending" || action.state === "done"}
            data-testid="inline-proposal-submit-for-review"
            className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-emerald-50 hover:bg-emerald-600 disabled:opacity-50"
          >
            <Send className="h-3 w-3" aria-hidden />
            {wasSubmitted ? "Submitted" : "Submit for review"}
          </button>
        ) : null}
      </footer>
    </section>
  );
}

function DiffRow({
  label,
  items,
  testid,
}: {
  label: string;
  items: string[];
  testid: string;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <ul data-testid={testid} className="flex flex-wrap gap-1 font-mono text-[11px]">
        {items.map((item) => (
          <li
            key={item}
            className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tally({ label, n }: { label: string; n: number }): React.ReactElement {
  return (
    <span className="rounded border border-border px-1.5 py-0.5">
      <span className="text-foreground">{n}</span> {label}
    </span>
  );
}
