"use client";

// Client components for the interactive setup steps.
//
// StewardForm — creates the first steward via POST /api/setup/steward.
// LLMKeyForm  — BYOK: validates + persists the provider key via
//               POST /api/setup/provider (key masked; stored server-side in .env).
// OrgProfileForm — writes uploads/org-profile.json (bind-mount-safe).
//
// All three mirror ScenarioPicker's fetch + res.ok/409 handling.

import { useRef, useState, useTransition } from "react";
import { saveOrgProfile } from "@/app/setup/actions";

// Mirrors PROVIDERS in lib/agent/mastra.ts. Inlined (not imported) to keep this
// client bundle free of the agent/server graph; the route is the validation
// source of truth.
const PROVIDERS = ["anthropic", "openai", "groq", "ollama", "opencode"] as const;

const INPUT_CLS =
  "mt-1.5 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors";
const LABEL_CLS = "text-[11px] text-muted-foreground uppercase tracking-wider";

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
    <p role="status" className={`mt-3 rounded border px-3 py-2 text-xs ${cls}`}>
      {state.message}
    </p>
  );
}

// ─── Create the first steward ────────────────────────────────────────────────

export function StewardForm({ alreadyExists }: { alreadyExists: boolean }) {
  const [toast, setToast] = useState<ToastState>(
    alreadyExists
      ? { kind: "ok", message: "A steward already exists for this deployment." }
      : { kind: "idle" },
  );
  const [done, setDone] = useState(alreadyExists);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    startTransition(async () => {
      try {
        const res = await fetch("/api/setup/steward", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          email?: string;
          error?: unknown;
        };
        if (res.ok) {
          setToast({
            kind: "ok",
            message: `Steward created: ${body.email}. Sign in with this account.`,
          });
          setDone(true);
          formRef.current?.reset();
        } else if (res.status === 409) {
          // Idempotent: a steward (or the whole setup) already exists.
          setToast({ kind: "ok", message: "A steward already exists for this deployment." });
          setDone(true);
        } else {
          setToast({
            kind: "error",
            message: typeof body.error === "string" ? body.error : `Failed (${res.status})`,
          });
        }
      } catch (err) {
        setToast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Create the first steward — the human who governs this deployment. You sign in with this account.
      </p>
      <label className="block">
        <span className={LABEL_CLS}>Email</span>
        <input
          type="email"
          name="email"
          required
          disabled={done}
          autoComplete="off"
          placeholder="you@your-org.coop"
          className={INPUT_CLS}
        />
      </label>
      <label className="block">
        <span className={LABEL_CLS}>Password</span>
        <input
          type="password"
          name="password"
          required
          minLength={8}
          disabled={done}
          autoComplete="new-password"
          placeholder="at least 8 characters"
          className={INPUT_CLS}
        />
      </label>
      <button
        type="submit"
        disabled={pending || done}
        className="rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-medium px-4 py-2 transition-colors disabled:opacity-50"
      >
        {done ? "Steward created" : pending ? "Creating…" : "Create steward"}
      </button>
      <Toast state={toast} />
    </form>
  );
}

// ─── BYOK LLM key (validated + persisted) ────────────────────────────────────

export function LLMKeyForm() {
  const [toast, setToast] = useState<ToastState>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const [provider, setProvider] = useState<string>("anthropic");
  const formRef = useRef<HTMLFormElement>(null);
  const needsKey = provider !== "ollama"; // ollama is keyless / localhost

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const apiKey = String(data.get("apiKey") ?? "").trim();
    const baseURL = String(data.get("baseURL") ?? "").trim();
    const model = String(data.get("model") ?? "").trim();
    startTransition(async () => {
      try {
        const res = await fetch("/api/setup/provider", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider,
            apiKey: apiKey || undefined,
            baseURL: baseURL || undefined,
            model: model || undefined,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        if (res.ok) {
          setToast({ kind: "ok", message: `Connected to ${provider}. Key saved.` });
          formRef.current?.reset();
          setProvider("anthropic");
        } else if (res.status === 409) {
          setToast({ kind: "error", message: "This deployment is already set up — the key is locked." });
        } else if (res.status === 422) {
          setToast({
            kind: "error",
            message:
              typeof body.error === "string"
                ? `Provider rejected the key: ${body.error}`
                : "Provider rejected the key — check it and try again.",
          });
        } else {
          setToast({
            kind: "error",
            message: typeof body.error === "string" ? body.error : `Save failed (${res.status})`,
          });
        }
      } catch (err) {
        setToast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Bring your own model. The key is validated against the provider and stored server-side
        in <code className="text-foreground">.env</code> — it powers the AI agent.
      </p>
      <label className="block">
        <span className={LABEL_CLS}>Provider</span>
        <select
          name="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className={INPUT_CLS}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      {needsKey && (
        <label className="block">
          <span className={LABEL_CLS}>API key</span>
          <input
            type="password"
            name="apiKey"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            className={`${INPUT_CLS} font-mono`}
          />
        </label>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-foreground transition-colors">
          Advanced — base URL &amp; model (optional)
        </summary>
        <div className="mt-2 space-y-2">
          <input
            type="text"
            name="baseURL"
            autoComplete="off"
            placeholder="base URL (e.g. http://localhost:11434 for ollama)"
            className={`${INPUT_CLS} font-mono`}
          />
          <input
            type="text"
            name="model"
            autoComplete="off"
            placeholder="model override (optional)"
            className={`${INPUT_CLS} font-mono`}
          />
        </div>
      </details>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-medium px-4 py-2 transition-colors disabled:opacity-50"
      >
        {pending ? "Validating…" : "Connect & save"}
      </button>
      <Toast state={toast} />
    </form>
  );
}

// ─── Org profile ──────────────────────────────────────────────────────────────

export function OrgProfileForm({
  initialName,
  initialDescription,
}: {
  initialName: string;
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
        Name your community and tell the AI what it is. The name shows in the
        sidebar across the app.
      </p>
      <label className="block">
        <span className={LABEL_CLS}>Organization name</span>
        <input
          type="text"
          name="name"
          maxLength={80}
          defaultValue={initialName}
          placeholder="e.g. Casa Verde"
          className={INPUT_CLS}
        />
      </label>
      <label className="block">
        <span className={LABEL_CLS}>Org description</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={initialDescription}
          placeholder="e.g. a 60-bed hostel in Spain running a work-exchange programme"
          className={`${INPUT_CLS} resize-none`}
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
