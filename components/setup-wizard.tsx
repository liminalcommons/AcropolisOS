"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

type Provider = "anthropic" | "openai" | "groq" | "ollama" | "opencode";
type Step = 1 | 2 | 3 | 4;

const PROVIDERS: { id: Provider; label: string; help: string }[] = [
  { id: "anthropic", label: "Anthropic", help: "Claude — paste your API key" },
  { id: "openai", label: "OpenAI", help: "GPT — paste your API key" },
  { id: "groq", label: "Groq", help: "Llama on Groq — paste your API key" },
  {
    id: "ollama",
    label: "Ollama",
    help: "Local — no key, set the base URL",
  },
  {
    id: "opencode",
    label: "OpenCode Zen",
    help: "Multi-model gateway — paste your OpenCode Go/Zen key",
  },
];

// Mirrors lib/agent/mastra.ts → OPENCODE_MODELS. Kept inline here to avoid
// pulling a server module into the client bundle.
const OPENCODE_MODELS: { id: string; tier: "go" | "zen" }[] = [
  { id: "qwen3.6-plus", tier: "go" },
  { id: "glm-5.1", tier: "go" },
  { id: "glm-5", tier: "go" },
  { id: "kimi-k2.6", tier: "go" },
  { id: "kimi-k2.5", tier: "go" },
  { id: "deepseek-v4-flash", tier: "go" },
  { id: "minimax-m2.7", tier: "go" },
  { id: "minimax-m2.5", tier: "go" },
  { id: "claude-opus-4-7", tier: "zen" },
  { id: "claude-sonnet-4-6", tier: "zen" },
  { id: "claude-haiku-4-5", tier: "zen" },
  { id: "gpt-5.5", tier: "zen" },
  { id: "gpt-5", tier: "zen" },
  { id: "gemini-3.1-pro", tier: "zen" },
];

const SEEDS: { id: "empty" | "small-community"; label: string; help: string }[] = [
  { id: "empty", label: "Empty", help: "Just the platform skeleton." },
  {
    id: "small-community",
    label: "Small community",
    help: "Members, stewards, events, proposals — a ready ontology.",
  },
];

interface Props {
  initialStep?: Step;
}

export function SetupWizard({ initialStep = 1 }: Props) {
  const [step, setStep] = useState<Step>(initialStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("http://localhost:11434");
  const [opencodeModel, setOpencodeModel] = useState<string>("qwen3.6-plus");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [seed, setSeed] = useState<"empty" | "small-community">("small-community");

  async function submitJson(url: string, payload: unknown): Promise<unknown> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : `request failed (${res.status})`,
      );
    }
    return body;
  }

  async function handleProvider(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitJson("/api/setup/provider", {
        provider,
        apiKey,
        ...(provider === "ollama" ? { baseURL } : {}),
        ...(provider === "opencode" ? { model: opencodeModel } : {}),
      });
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSteward(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitJson("/api/setup/steward", { email, password });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleOntology(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitJson("/api/setup/ontology", { seed });
      // sign the new steward in, then redirect to /chat
      await signIn("credentials", {
        email,
        password,
        redirect: true,
        callbackUrl: "/chat",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto px-8 py-12 text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight">acropolisOS setup</h1>
      <ol className="mt-4 flex gap-2 text-xs text-muted-foreground" aria-label="Progress">
        {[1, 2, 3].map((n) => (
          <li
            key={n}
            data-active={step === n}
            className="data-[active=true]:text-foreground"
          >
            {`Step ${n}`}
          </li>
        ))}
      </ol>

      {error ? (
        <p role="alert" className="mt-4 rounded border border-destructive/60 bg-destructive/15 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {step === 1 ? (
        <form onSubmit={handleProvider} className="mt-8 space-y-4">
          <fieldset>
            <legend className="text-sm font-medium">LLM provider</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => (
                <label
                  key={p.id}
                  className="cursor-pointer rounded border border-border p-3 hover:border-ring has-checked:border-foreground"
                >
                  <input
                    type="radio"
                    name="provider"
                    value={p.id}
                    checked={provider === p.id}
                    onChange={() => setProvider(p.id)}
                    className="sr-only"
                  />
                  <span className="block font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">{p.help}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {provider === "ollama" ? (
            <label className="block text-sm">
              Base URL
              <input
                type="url"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-input p-2"
              />
            </label>
          ) : (
            <label className="block text-sm">
              API key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
                autoComplete="off"
                className="mt-1 w-full rounded border border-border bg-input p-2"
              />
            </label>
          )}
          {provider === "opencode" ? (
            <label className="block text-sm">
              Model
              <select
                value={opencodeModel}
                onChange={(e) => setOpencodeModel(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-input p-2"
              >
                <optgroup label="Open-weight (qwen, glm, kimi, deepseek, minimax)">
                  {OPENCODE_MODELS.filter((m) => m.tier === "go").map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Closed (claude, gpt, gemini)">
                  {OPENCODE_MODELS.filter((m) => m.tier === "zen").map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </optgroup>
              </select>
              <span className="mt-1 block text-xs text-muted-foreground">
                Every model — including open-weight ones — bills against your
                OpenCode Zen credit balance. The OpenCode Go plan ($10/mo)
                covers the OpenCode CLI/TUI, not external API consumption.
                Add Zen credits at opencode.ai/workspace/&lt;your-workspace&gt;/billing.
              </span>
            </label>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Validating…" : "Validate & continue"}
          </button>
        </form>
      ) : null}

      {step === 2 ? (
        <form onSubmit={handleSteward} className="mt-8 space-y-4">
          <p className="text-sm text-muted-foreground">
            Create the first steward account. You will sign in with these credentials.
          </p>
          <label className="block text-sm">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded border border-border bg-input p-2"
            />
          </label>
          <label className="block text-sm">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="mt-1 w-full rounded border border-border bg-input p-2"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>
      ) : null}

      {step === 3 ? (
        <form onSubmit={handleOntology} className="mt-8 space-y-4">
          <fieldset>
            <legend className="text-sm font-medium">Seed ontology</legend>
            <div className="mt-2 grid gap-2">
              {SEEDS.map((s) => (
                <label
                  key={s.id}
                  className="cursor-pointer rounded border border-border p-3 hover:border-ring has-checked:border-foreground"
                >
                  <input
                    type="radio"
                    name="seed"
                    value={s.id}
                    checked={seed === s.id}
                    onChange={() => setSeed(s.id)}
                    className="sr-only"
                  />
                  <span className="block font-medium">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.help}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            This copies the seed files, generates types, and runs database migrations.
            It can take 10–30 seconds.
          </p>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Installing ontology…" : "Finish setup"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
