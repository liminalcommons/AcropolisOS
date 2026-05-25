"use client";

// Client components for the two interactive setup steps.
//
// LLMKeyForm  — Step 2, BYOK. Calls saveLLMKey server action.
//               Persistence is STUBBED this cycle — key is never stored.
//               Shows a toast on success.
//
// OrgProfileForm — Step 3. Calls saveOrgProfile server action.
//                  Writes uploads/org-profile.json (bind-mount-safe).

import { useRef, useState, useTransition } from "react";
import { saveLLMKey, saveOrgProfile } from "@/app/setup/actions";

// ─── Shared toast ─────────────────────────────────────────────────────────────

type ToastState =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

function Toast({ state }: { state: ToastState }) {
  if (state.kind === "idle") return null;
  const cls =
    state.kind === "ok"
      ? "border-emerald-800 bg-emerald-950/30 text-emerald-300"
      : "border-rose-800 bg-rose-950/30 text-rose-300";
  return (
    <p
      role="status"
      className={`mt-3 rounded border px-3 py-2 text-xs ${cls}`}
    >
      {state.message}
    </p>
  );
}

// ─── Step 2: BYOK LLM key (stubbed save) ─────────────────────────────────────

export function LLMKeyForm() {
  const [toast, setToast] = useState<ToastState>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveLLMKey(data);
      if (result.ok) {
        setToast({ kind: "ok", message: result.message });
        formRef.current?.reset();
      } else {
        setToast({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Paste your LLM provider API key. This enables the AI agent on the
        dashboard.
      </p>
      <label className="block">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
          API key
        </span>
        <textarea
          name="key"
          rows={2}
          placeholder="sk-ant-api03-…"
          autoComplete="off"
          spellCheck={false}
          className="mt-1.5 w-full rounded-md border border-border bg-input px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-ring transition-colors"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-medium px-4 py-2 transition-colors disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save key"}
        </button>
        <span className="text-[10px] text-muted-foreground italic">
          Storage is stubbed — key is not persisted this cycle.
        </span>
      </div>
      <Toast state={toast} />
    </form>
  );
}

// ─── Step 3: Org profile ──────────────────────────────────────────────────────

export function OrgProfileForm({
  initialDescription,
}: {
  initialDescription: string;
}) {
  const [toast, setToast] = useState<ToastState>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveOrgProfile(data);
      if (result.ok) {
        setToast({ kind: "ok", message: "Saved." });
      } else {
        setToast({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Help the AI understand your world from the start. One or two sentences
        is enough.
      </p>
      <label className="block">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
          Org description
        </span>
        <textarea
          name="description"
          rows={3}
          defaultValue={initialDescription}
          placeholder="e.g. a 60-bed hostel in Spain running a work-exchange programme"
          className="mt-1.5 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-emerald-700 transition-colors"
        />
      </label>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-700 hover:bg-emerald-600 text-emerald-50 text-xs font-semibold px-5 py-2 transition-colors disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <Toast state={toast} />
    </form>
  );
}
