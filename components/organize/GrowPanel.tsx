// GROW trigger UI — turns a staged raw_inbox row into ontology growth from the
// /organize surface, then sends you to /graph to watch it land. Steward-only
// (the route enforces it too). The type name decides the path: an EXISTING type
// grows additively (novel fields auto-apply); a NEW name escalates a pending
// proposal you approve on the graph.
"use client";

import { useState } from "react";
import Link from "next/link";

interface Row {
  id: string;
  payload: unknown;
}

interface GrowResult {
  grew: boolean;
  escalated: string[];
  autoApplied: string[];
  error?: string;
}

function payloadKeys(payload: unknown): string[] {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? Object.keys(payload as Record<string, unknown>)
    : [];
}

export function GrowPanel({ rows }: { rows: Row[] }): React.ReactElement {
  const [rowId, setRowId] = useState(rows[0]?.id ?? "");
  const [typeName, setTypeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GrowResult | null>(null);

  const selected = rows.find((r) => r.id === rowId);
  const keys = payloadKeys(selected?.payload);

  async function grow(): Promise<void> {
    if (!rowId || !typeName.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/organize/grow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbox_id: rowId, target_type: typeName.trim() }),
      });
      const j = (await res.json()) as Partial<GrowResult> & { error?: string };
      setResult(
        res.ok
          ? { grew: !!j.grew, escalated: j.escalated ?? [], autoApplied: j.autoApplied ?? [] }
          : { grew: false, escalated: [], autoApplied: [], error: j.error ?? `HTTP ${res.status}` },
      );
    } catch (e) {
      setResult({ grew: false, escalated: [], autoApplied: [], error: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card/30 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">Grow the ontology from a row</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Feed a row that doesn&apos;t fit. A <span className="font-medium">new</span> concept becomes a proposal
          you approve on the graph; novel fields on an <span className="font-medium">existing</span> type apply
          automatically.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
        <label className="block text-[11px] text-muted-foreground">
          Row
          <select
            value={rowId}
            onChange={(e) => {
              setRowId(e.target.value);
              setResult(null);
            }}
            className="mt-1 w-full rounded border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-ring"
          >
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {payloadKeys(r.payload).slice(0, 4).join(", ") || r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-[11px] text-muted-foreground">
          Type name
          <input
            value={typeName}
            onChange={(e) => setTypeName(e.target.value)}
            placeholder="e.g. Vehicle, or an existing type"
            className="mt-1 w-full rounded border border-border bg-input px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring"
          />
        </label>

        <button
          type="button"
          onClick={grow}
          disabled={busy || !rowId || !typeName.trim()}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? "Growing…" : "Grow →"}
        </button>
      </div>

      {keys.length > 0 && (
        <p className="text-[10px] text-muted-foreground/70">
          fields in row: {keys.join(", ")}
        </p>
      )}

      {result && (
        <div className="rounded-md border border-border bg-background/40 p-3 text-xs space-y-1">
          {result.error ? (
            <p className="text-destructive">Couldn&apos;t grow: {result.error}</p>
          ) : !result.grew ? (
            <p className="text-muted-foreground">That row already fits the ontology — nothing to grow.</p>
          ) : (
            <>
              {result.escalated.length > 0 && (
                <p className="text-amber-300/90">
                  Proposed new {result.escalated.length === 1 ? "type" : "types"}:{" "}
                  <span className="font-medium">{result.escalated.join(", ")}</span> · awaiting your approval
                </p>
              )}
              {result.autoApplied.length > 0 && (
                <p className="text-emerald-300/90">
                  Auto-applied {result.autoApplied.length} field{result.autoApplied.length !== 1 ? "s" : ""}:{" "}
                  <span className="font-medium">{result.autoApplied.join(", ")}</span> ✓
                </p>
              )}
              <Link
                href="/graph"
                className="inline-block mt-1 underline underline-offset-2 text-foreground hover:text-muted-foreground"
              >
                Watch it on the graph →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
