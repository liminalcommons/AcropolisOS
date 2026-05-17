"use client";

import { useRef, useState } from "react";

interface UploadResponse {
  inboxIds: string[];
  count: number;
}

export function InboxDropzone() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [over, setOver] = useState(false);

  async function uploadFiles(files: FileList | File[]) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch("/api/inbox/upload", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as Partial<UploadResponse> & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      setResult({ inboxIds: body.inboxIds ?? [], count: body.count ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded border border-zinc-700 bg-zinc-900/40 p-4">
      <h2 className="text-sm font-medium text-zinc-200">Drop data into the inbox</h2>
      <p className="mt-1 text-xs text-zinc-500">
        CSV, JSON, or Markdown — the agent will propose where rows belong.
      </p>

      <div
        data-testid="inbox-dropzone"
        data-over={over}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length > 0) {
            void uploadFiles(e.dataTransfer.files);
          }
        }}
        onClick={() => inputRef.current?.click()}
        className="mt-3 cursor-pointer rounded border border-dashed border-zinc-700 px-4 py-8 text-center text-sm text-zinc-400 data-[over=true]:border-zinc-300 data-[over=true]:text-zinc-100"
      >
        {busy ? "Uploading…" : "Drag files here or click to choose"}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".csv,.json,.md,.markdown,text/csv,application/json,text/markdown"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void uploadFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {error ? (
        <p role="alert" className="mt-3 rounded border border-red-700 bg-red-900/30 p-2 text-xs">
          {error}
        </p>
      ) : null}
      {result ? (
        <p className="mt-3 text-xs text-emerald-400">
          Ingested {result.count} row{result.count === 1 ? "" : "s"}.
        </p>
      ) : null}
    </section>
  );
}
