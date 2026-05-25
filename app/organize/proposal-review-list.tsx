"use client";

// A3: ProposalReviewList — interactive classify + proposal review surface.
//
// Per raw_inbox row:
//   1. Shows source badge + payload preview.
//   2. "Classify" button calls POST /api/organize/classify { inbox_id } and
//      shows a spinner while the LLM runs (~60-120s expected).
//   3. On response, renders a proposal review card:
//      - target_type heading + confidence bar
//      - field-mapping table (source key → target field; unmapped keys muted)
//      - reasoning excerpt
//      - Confirm / Reject / Edit-mapping controls
//
// A3 wires the Confirm button to the real confirmProposal server action:
//   - Steward-gated, zod-validated, field_map re-validated server-side
//   - Writes typed row to world-model + stamps raw_inbox provenance
//   - Idempotent: already_classified rows cannot double-commit
//   Reject  → local state only (row returns to idle)
//   Edit    → not yet implemented (A4)

import { useState } from "react";
import type { RawInboxRow } from "@/lib/db/schema";
import { confirmProposal } from "./actions";
import type { CommitProposalInput, Resolution } from "@/lib/organize/commit";
import type { DuplicateCandidate } from "@/lib/organize/resolve";

// ── Types ─────────────────────────────────────────────────────────────────────

// Proposal uses CommitProposalInput directly so the type flows cleanly into
// confirmProposal without a cast. The A1 classify route validates target_type
// against the same TARGET_TYPE_ENUM, so the runtime types align.
type Proposal = CommitProposalInput;

type RowPhase =
  | { tag: "idle" }
  | { tag: "classifying" }
  | { tag: "proposal"; proposal: Proposal }
  | { tag: "error"; message: string }
  | { tag: "rejected" };

interface RowState {
  phase: RowPhase;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  manual: "bg-card text-foreground",
  "sheets-import": "bg-blue-900/50 text-blue-300",
  "webhook-booking": "bg-primary/20 text-primary",
  "file-drop": "bg-teal-900/50 text-teal-300",
};

function sourceBadgeClass(source: string): string {
  return SOURCE_COLORS[source] ?? "bg-card text-muted-foreground";
}

function confidenceColor(conf: number): string {
  if (conf >= 0.8) return "bg-emerald-500";
  if (conf >= 0.5) return "bg-amber-500";
  return "bg-red-500";
}

function payloadPreview(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return String(payload);
  }
  const entries = Object.entries(payload as Record<string, unknown>).slice(0, 4);
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ");
}

// ── Confirm result state ──────────────────────────────────────────────────────

type ConfirmState =
  | { tag: "idle" }
  | { tag: "committed"; typed_row_id: string; target_type: string }
  | { tag: "already_classified" }
  | { tag: "forbidden" }
  | { tag: "incomplete_refs"; missing: string[] }
  | { tag: "commit_error"; detail: string }
  | { tag: "error"; message: string }
  // A4 statuses
  | { tag: "duplicate_candidate"; candidates: DuplicateCandidate[]; proposal: CommitProposalInput }
  | { tag: "merged"; merged_into: string };

// ── Sub-components ────────────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  onReject,
  onConfirm,
}: {
  proposal: Proposal;
  onReject: () => void;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>({ tag: "idle" });

  async function handleConfirm(resolution?: Resolution) {
    setConfirming(true);
    // If we're resolving a duplicate_candidate, use the proposal stored in state
    // (the server already validated it and returned it back in the candidate response).
    const proposalToSubmit =
      confirmState.tag === "duplicate_candidate" ? confirmState.proposal : proposal;
    try {
      const result = await confirmProposal(proposalToSubmit, resolution);
      if (result.status === "committed") {
        setConfirmState({
          tag: "committed",
          typed_row_id: result.typed_row_id,
          target_type: result.target_type,
        });
        onConfirm();
      } else if (result.status === "already_classified") {
        setConfirmState({ tag: "already_classified" });
      } else if (result.status === "forbidden") {
        setConfirmState({ tag: "forbidden" });
      } else if (result.status === "incomplete_required_refs") {
        setConfirmState({ tag: "incomplete_refs", missing: result.missing });
      } else if (result.status === "commit_error") {
        setConfirmState({ tag: "commit_error", detail: result.detail });
      } else if (result.status === "duplicate_candidate") {
        // A4: server found near-match candidates — show them for human resolution
        setConfirmState({
          tag: "duplicate_candidate",
          candidates: result.candidates,
          proposal: result.proposal,
        });
      } else if (result.status === "merged") {
        // A4: human chose merge-into-existing — row is marked processed, no new row
        setConfirmState({ tag: "merged", merged_into: result.merged_into });
        onConfirm();
      } else {
        setConfirmState({
          tag: "error",
          message: (result as { status: string }).status,
        });
      }
    } catch (err) {
      setConfirmState({
        tag: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setConfirming(false);
    }
  }

  const allMapped = Object.entries(proposal.field_map);
  const unmappedSet = new Set(proposal.unmapped);

  return (
    <div className="mt-3 rounded-lg border border-border bg-card/50 p-4 space-y-4">

      {/* Type + confidence */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-xs uppercase tracking-widest text-muted-foreground mr-2">
            target type
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {proposal.target_type}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">
            {Math.round(proposal.confidence * 100)}% confidence
          </span>
          <div className="w-20 h-1.5 rounded-full bg-card overflow-hidden">
            <div
              className={`h-full rounded-full ${confidenceColor(proposal.confidence)}`}
              style={{ width: `${Math.round(proposal.confidence * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Field mapping table */}
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          field mapping
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground/60">
              <th className="text-left font-normal pb-1 pr-4">source key</th>
              <th className="text-left font-normal pb-1">→ target field</th>
            </tr>
          </thead>
          <tbody>
            {allMapped.map(([src, tgt]) => (
              <tr key={src} className="border-t border-border/60">
                <td className="py-1 pr-4 font-mono text-foreground">{src}</td>
                <td className="py-1 font-mono text-emerald-400">{tgt}</td>
              </tr>
            ))}
            {proposal.unmapped.map((src) => (
              <tr key={src} className="border-t border-border/60">
                <td className="py-1 pr-4 font-mono text-muted-foreground/60">{src}</td>
                <td className="py-1 font-mono text-muted-foreground/60 italic">unmapped</td>
              </tr>
            ))}
          </tbody>
        </table>
        {allMapped.length === 0 && proposal.unmapped.length === 0 && (
          <p className="text-muted-foreground/60 text-xs italic">No keys extracted.</p>
        )}
      </div>

      {/* Reasoning */}
      {proposal.reasoning && (
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
            reasoning
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {proposal.reasoning}
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        {confirmState.tag === "committed" ? (
          <p className="text-xs text-emerald-400">
            Committed — {confirmState.target_type} row{" "}
            <span className="font-mono opacity-70">{confirmState.typed_row_id}</span>
          </p>
        ) : confirmState.tag === "already_classified" ? (
          <p className="text-xs text-amber-400/80">Already committed — no double-write.</p>
        ) : confirmState.tag === "forbidden" ? (
          <p className="text-xs text-red-400">Forbidden — steward role required.</p>
        ) : confirmState.tag === "incomplete_refs" ? (
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p className="text-muted-foreground">
              Needs resolution — links to other records (handled in A4).
            </p>
            <p className="text-muted-foreground/60 font-mono">
              Missing: {confirmState.missing.join(", ")}
            </p>
          </div>
        ) : confirmState.tag === "commit_error" ? (
          <p className="text-xs text-red-400">
            Write error — {confirmState.detail.slice(0, 120)}
          </p>
        ) : confirmState.tag === "error" ? (
          <p className="text-xs text-red-400 font-mono">{confirmState.message}</p>
        ) : confirmState.tag === "merged" ? (
          <p className="text-xs text-muted-foreground">
            Merged into existing row{" "}
            <span className="font-mono opacity-70">{confirmState.merged_into}</span>
            {" "}— incoming duplicate discarded.
          </p>
        ) : confirmState.tag === "duplicate_candidate" ? (
          // A4: human-gated resolve — show candidates, no silent action
          <div className="w-full space-y-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">
                possible duplicate — choose action
              </p>
              <div className="space-y-2">
                {confirmState.candidates.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded border border-border/60 bg-card/30 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="text-xs text-foreground font-medium truncate">{c.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {Math.round(c.score * 100)}% match
                      </span>
                      <span className="text-xs font-mono text-muted-foreground/60 ml-2 truncate">
                        {c.id.slice(0, 8)}…
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleConfirm({ merge_into: c.id })}
                      disabled={confirming}
                      className="shrink-0 rounded border border-border bg-card/40 px-3 py-1 text-[11px] font-medium text-foreground hover:bg-card/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {confirming ? "…" : `Merge into "${c.label.slice(0, 24)}${c.label.length > 24 ? "…" : ""}"`}
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleConfirm("create_new")}
                disabled={confirming}
                className="rounded-md border border-emerald-800/50 bg-emerald-900/15 px-4 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {confirming ? "…" : "Create new anyway"}
              </button>
              <button
                type="button"
                onClick={onReject}
                className="rounded-md border border-border bg-card/40 px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card/50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirming}
              className="rounded-md border border-emerald-700/60 bg-emerald-900/20 px-4 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {confirming ? "…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={onReject}
              className="rounded-md border border-border bg-card/40 px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card/50 transition-colors"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main list component ───────────────────────────────────────────────────────

interface ProposalReviewListProps {
  rows: RawInboxRow[];
  isSteward: boolean;
}

export function ProposalReviewList({ rows, isSteward }: ProposalReviewListProps) {
  const [states, setStates] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, { phase: { tag: "idle" } }]))
  );

  function setPhase(id: string, phase: RowPhase) {
    setStates((prev) => ({ ...prev, [id]: { phase } }));
  }

  async function handleClassify(row: RawInboxRow) {
    if (!isSteward) return;
    setPhase(row.id, { tag: "classifying" });
    try {
      const res = await fetch("/api/organize/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbox_id: row.id }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setPhase(row.id, {
          tag: "error",
          message: `${res.status} ${body.error ?? "classify failed"}`,
        });
        return;
      }

      const proposal = (await res.json()) as Proposal;
      setPhase(row.id, { tag: "proposal", proposal });
    } catch (err) {
      setPhase(row.id, {
        tag: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <ul className="space-y-4" data-testid="proposal-review-list">
      {rows.map((row) => {
        const state = states[row.id] ?? { phase: { tag: "idle" } };
        const phase = state.phase;

        return (
          <li
            key={row.id}
            className="rounded-lg border border-border bg-card p-4"
            data-inbox-id={row.id}
          >
            {/* Row header */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <span className={`text-xs font-mono px-2 py-0.5 rounded ${sourceBadgeClass(row.source)}`}>
                {row.source}
              </span>
              <span className="text-xs font-mono text-muted-foreground/60 shrink-0">
                {new Date(row.received_at).toISOString().replace("T", " ").slice(0, 16)}
              </span>
            </div>

            {/* Payload preview */}
            <p className="text-xs text-muted-foreground font-mono leading-relaxed mb-3 truncate">
              {payloadPreview(row.payload)}
            </p>

            {/* Phase-dependent rendering */}
            {phase.tag === "idle" && (
              <button
                type="button"
                onClick={() => void handleClassify(row)}
                disabled={!isSteward}
                title={isSteward ? undefined : "Steward role required"}
                className="rounded-md border border-border bg-card/40 px-4 py-1.5 text-xs font-medium text-foreground hover:bg-card/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Classify
              </button>
            )}

            {phase.tag === "classifying" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="inline-block h-3 w-3 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin"
                  aria-hidden="true"
                />
                Classifying… (LLM running, ~60–120 s)
              </div>
            )}

            {phase.tag === "error" && (
              <div className="space-y-2">
                <p className="text-xs text-destructive font-mono">{phase.message}</p>
                <button
                  type="button"
                  onClick={() => void handleClassify(row)}
                  disabled={!isSteward}
                  className="rounded-md border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground hover:bg-card/60 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {phase.tag === "proposal" && (
              <ProposalCard
                proposal={phase.proposal}
                onReject={() => setPhase(row.id, { tag: "rejected" })}
                onConfirm={() => {
                  // ProposalCard calls onConfirm after a successful commit.
                  // Move the row to "committed" phase so the list collapses it.
                  setPhase(row.id, { tag: "idle" });
                }}
              />
            )}

            {phase.tag === "rejected" && (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground/60">Proposal rejected.</span>
                <button
                  type="button"
                  onClick={() => setPhase(row.id, { tag: "idle" })}
                  className="text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  Re-classify
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
