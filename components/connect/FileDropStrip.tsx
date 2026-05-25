"use client";

// F2-step1: FileDropStrip — drag-and-drop or click-to-select CSV/JSON files.
//
// On drop/select:
//   1. Client-side parse: CSV (header row + split) or JSON (array or object).
//   2. POST each row to /api/connect/upload with { source: 'file-drop', payload: row }.
//   3. Show progress → final count → link to /organize.
//
// No external CSV dep — basic split-on-comma only. Quoted-comma edge cases
// are a follow-up (scope comment in spec).

import { useRef, useState } from "react";
import Link from "next/link";

// ── Tiny inline CSV parser ────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
}

// ── Payload extraction ────────────────────────────────────────────────────────

function extractRows(text: string, mime: string, filename: string): unknown[] {
  const isCsv =
    mime === "text/csv" ||
    filename.toLowerCase().endsWith(".csv");

  if (isCsv) {
    return parseCSV(text);
  }

  // JSON path
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Could not parse ${filename} as JSON`);
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return [parsed];
  throw new Error(`${filename}: expected JSON array or object`);
}

// ── Upload single row ─────────────────────────────────────────────────────────

async function uploadRow(payload: unknown): Promise<void> {
  const res = await fetch("/api/connect/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "file-drop", payload }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `upload failed (${res.status})`);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

type UploadState =
  | { phase: "idle" }
  | { phase: "busy"; done: number; total: number }
  | { phase: "done"; count: number }
  | { phase: "error"; message: string };

export function FileDropStrip() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [state, setState] = useState<UploadState>({ phase: "idle" });

  async function handleFiles(files: FileList | File[]) {
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;

    // Parse all files into rows first
    const allRows: unknown[] = [];
    for (const file of fileArr) {
      const text = await file.text();
      try {
        const rows = extractRows(text, file.type, file.name);
        allRows.push(...rows);
      } catch (err) {
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }

    if (allRows.length === 0) {
      setState({ phase: "error", message: "No rows found in file(s)" });
      return;
    }

    setState({ phase: "busy", done: 0, total: allRows.length });

    let done = 0;
    for (const row of allRows) {
      try {
        await uploadRow(row);
      } catch (err) {
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      done++;
      setState({ phase: "busy", done, total: allRows.length });
    }

    setState({ phase: "done", count: done });
  }

  const isBusy = state.phase === "busy";

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        data-testid="file-drop-strip"
        data-over={over}
        onClick={() => !isBusy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!isBusy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!isBusy && e.dataTransfer.files.length > 0) {
            void handleFiles(e.dataTransfer.files);
          }
        }}
        className={[
          "cursor-pointer rounded border border-dashed px-4 py-3 text-center transition-colors",
          over
            ? "border-border text-foreground"
            : "border-border text-muted-foreground hover:border-ring hover:text-foreground",
          isBusy ? "opacity-60 cursor-not-allowed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {state.phase === "busy" ? (
          <span className="text-xs">
            Uploading… {state.done}/{state.total} rows
          </span>
        ) : (
          <span className="text-xs">
            Drop a CSV or JSON file here, or{" "}
            <span className="underline underline-offset-2">click to choose</span>
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".csv,.json,application/json,text/csv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {/* Status */}
      {state.phase === "error" && (
        <p
          role="alert"
          className="rounded border border-destructive/60 bg-destructive/15 px-3 py-2 text-xs text-destructive"
        >
          {state.message}
        </p>
      )}

      {state.phase === "done" && (
        <p className="text-xs text-emerald-400">
          Pushed {state.count} row{state.count === 1 ? "" : "s"} into raw_inbox.{" "}
          <Link href="/organize" className="underline underline-offset-2 hover:text-emerald-300">
            View at /organize →
          </Link>
        </p>
      )}
    </div>
  );
}
