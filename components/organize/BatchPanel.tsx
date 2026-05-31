// BatchPanel — sample-then-bulk-ingest a whole source from /organize.
//
// Scalability companion to the per-row Classify/Confirm flow. The steward picks
// a source (grouped + counted server-side), clicks "Sample & propose type" to get
// ONE proposed { target_type, field_map } for the group (via /api/organize/batch-classify,
// READ-ONLY), reviews it, then "Apply to all N" bulk-ingests every unclassified row
// of that source (via /api/organize/batch-apply). Steward-only (routes enforce it too).
"use client";

import { useState } from "react";

export interface SourceGroup {
  source: string;
  n: number;
}

interface BatchProposal {
  source: string;
  target_type: string;
  field_map: Record<string, string>;
  confidence: number;
  unmapped: string[];
  reasoning: string;
  sample_size: number;
  total_in_source: number;
}

interface ApplyResult {
  attempted: number;
  committed: number;
  already_classified: number;
  incomplete_refs: number;
  merged: number;
  errors: number;
  missing_refs: string[];
  first_error: string | null;
  remaining: number;
}

type Phase =
  | { tag: "idle" }
  | { tag: "sampling" }
  | { tag: "proposal"; proposal: BatchProposal }
  | { tag: "applying"; proposal: BatchProposal }
  | { tag: "applied"; result: ApplyResult; proposal: BatchProposal }
  | { tag: "error"; message: string };

function confidenceColor(conf: number): string {
  if (conf >= 0.8) return "bg-emerald-500";
  if (conf >= 0.5) return "bg-amber-500";
  return "bg-red-500";
}

export function BatchPanel({ sources }: { sources: SourceGroup[] }): React.ReactElement {
  const [source, setSource] = useState(sources[0]?.source ?? "");
  const [phase, setPhase] = useState<Phase>({ tag: "idle" });

  const selected = sources.find((s) => s.source === source);

  async function sample(): Promise<void> {
    if (!source) return;
    setPhase({ tag: "sampling" });
    try {
      const res = await fetch("/api/organize/batch-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setPhase({ tag: "error", message: `${res.status} ${body.error ?? "sample failed"}` });
        return;
      }
      const proposal = (await res.json()) as BatchProposal;
      setPhase({ tag: "proposal", proposal });
    } catch (err) {
      setPhase({ tag: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function apply(proposal: BatchProposal): Promise<void> {
    setPhase({ tag: "applying", proposal });
    try {
      const res = await fetch("/api/organize/batch-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: proposal.source,
          target_type: proposal.target_type,
          field_map: proposal.field_map,
          confidence: proposal.confidence,
          unmapped: proposal.unmapped,
          reasoning: proposal.reasoning,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<ApplyResult> & { error?: string };
      if (!res.ok) {
        setPhase({ tag: "error", message: `${res.status} ${body.error ?? "apply failed"}` });
        return;
      }
      setPhase({ tag: "applied", result: body as ApplyResult, proposal });
    } catch (err) {
      setPhase({ tag: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const mapped = phase.tag === "proposal" || phase.tag === "applying" || phase.tag === "applied"
    ? Object.entries(phase.proposal.field_map)
    : [];

  return (
    <div className="rounded-lg border border-border bg-card/30 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">Batch-classify a whole source</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Pick a source, sample {`~`}20 rows, and propose ONE type for the group. On approval, every
          unclassified row of that source is ingested at once — no per-row clicking.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-end">
        <label className="block text-[11px] text-muted-foreground">
          Source
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPhase({ tag: "idle" });
            }}
            className="mt-1 w-full rounded border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-ring"
          >
            {sources.map((s) => (
              <option key={s.source} value={s.source}>
                {s.source} ({s.n} unclassified)
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={sample}
          disabled={!source || phase.tag === "sampling" || phase.tag === "applying"}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {phase.tag === "sampling" ? "Sampling…" : "Sample & propose type →"}
        </button>
      </div>

      {phase.tag === "sampling" && (
        <p className="text-[11px] text-muted-foreground">Running the model on ~20 sample rows (~60–120 s)…</p>
      )}

      {(phase.tag === "proposal" || phase.tag === "applying") && (
        <div className="rounded-md border border-border bg-background/40 p-3 text-xs space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-2">type</span>
              <span className="font-mono text-sm font-semibold text-foreground">{phase.proposal.target_type}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-muted-foreground">{Math.round(phase.proposal.confidence * 100)}%</span>
              <div className="w-16 h-1.5 rounded-full bg-card overflow-hidden">
                <div
                  className={`h-full rounded-full ${confidenceColor(phase.proposal.confidence)}`}
                  style={{ width: `${Math.round(phase.proposal.confidence * 100)}%` }}
                />
              </div>
            </div>
          </div>

          <table className="w-full">
            <thead>
              <tr className="text-muted-foreground/60">
                <th className="text-left font-normal pb-1 pr-4">source key</th>
                <th className="text-left font-normal pb-1">→ target field</th>
              </tr>
            </thead>
            <tbody>
              {mapped.map(([src, tgt]) => (
                <tr key={src} className="border-t border-border/60">
                  <td className="py-1 pr-4 font-mono text-foreground">{src}</td>
                  <td className="py-1 font-mono text-emerald-400">{tgt}</td>
                </tr>
              ))}
              {phase.proposal.unmapped.map((src) => (
                <tr key={src} className="border-t border-border/60">
                  <td className="py-1 pr-4 font-mono text-muted-foreground/60">{src}</td>
                  <td className="py-1 font-mono text-muted-foreground/60 italic">unmapped</td>
                </tr>
              ))}
            </tbody>
          </table>

          {phase.proposal.reasoning && (
            <p className="text-muted-foreground leading-relaxed">{phase.proposal.reasoning}</p>
          )}

          <p className="text-muted-foreground/70">
            Sampled {phase.proposal.sample_size} of {phase.proposal.total_in_source} rows in{" "}
            <span className="font-mono">{phase.proposal.source}</span>.
          </p>

          <button
            type="button"
            onClick={() => void apply(phase.proposal)}
            disabled={phase.tag === "applying"}
            className="rounded-md border border-emerald-700/60 bg-emerald-900/20 px-4 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {phase.tag === "applying"
              ? `Ingesting ${phase.proposal.total_in_source} rows…`
              : `Apply to all ${phase.proposal.total_in_source} rows`}
          </button>
        </div>
      )}

      {phase.tag === "applied" && (
        <div className="rounded-md border border-border bg-background/40 p-3 text-xs space-y-1">
          <p className="text-emerald-300/90">
            Committed {phase.result.committed} of {phase.result.attempted} {phase.proposal.target_type} rows ✓
          </p>
          {phase.result.already_classified > 0 && (
            <p className="text-muted-foreground">{phase.result.already_classified} already classified (skipped).</p>
          )}
          {phase.result.incomplete_refs > 0 && (
            <p className="text-amber-300/90">
              {phase.result.incomplete_refs} need links not in the field map
              {phase.result.missing_refs.length > 0 && (
                <span className="font-mono"> ({phase.result.missing_refs.join(", ")})</span>
              )}{" "}
              — not batch-ingestible yet.
            </p>
          )}
          {phase.result.errors > 0 && (
            <p className="text-rose-400">
              {phase.result.errors} error{phase.result.errors !== 1 ? "s" : ""}
              {phase.result.first_error && (
                <span className="font-mono"> — {phase.result.first_error.slice(0, 120)}</span>
              )}
            </p>
          )}
          {phase.result.remaining > 0 && (
            <p className="text-muted-foreground">
              {phase.result.remaining} more in this source — run again to continue.
            </p>
          )}
        </div>
      )}

      {phase.tag === "error" && <p className="text-xs text-rose-400 font-mono">{phase.message}</p>}

      {selected && phase.tag === "idle" && (
        <p className="text-[10px] text-muted-foreground/70">
          {selected.n} unclassified row{selected.n !== 1 ? "s" : ""} in this source.
        </p>
      )}
    </div>
  );
}
