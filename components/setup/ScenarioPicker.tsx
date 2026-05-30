"use client";

// Step 4 — first-run scenario pick. The choices come from listScenarioChoices()
// (discovered from scenarios/<name>/scenario.json), so this list is never a
// hardcoded enumeration. Installing POSTs to /api/setup/ontology, which copies
// the chosen bundle's ontology into the runtime dir, runs codegen + migrations,
// and marks setup complete (409 if it already is — single-org installs lock).

import { useState, useTransition } from "react";
import type { ScenarioChoice } from "@/lib/setup/scenario-choices";

type Toast =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function ScenarioPicker({
  choices,
  alreadyComplete,
}: {
  choices: ScenarioChoice[];
  alreadyComplete: boolean;
}) {
  const [selected, setSelected] = useState(
    choices.find((c) => c.default)?.name ?? choices[0]?.name ?? "",
  );
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast>({ kind: "idle" });

  function install() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/setup/ontology", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ seed: selected }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: unknown;
        };
        if (res.ok) {
          setToast({
            kind: "ok",
            message: `Installed "${selected}". Reload the app to see it.`,
          });
        } else if (res.status === 409) {
          setToast({
            kind: "error",
            message: "This deployment is already set up — the scenario is locked.",
          });
        } else {
          setToast({
            kind: "error",
            message:
              typeof body.error === "string"
                ? body.error
                : `Install failed (${res.status})`,
          });
        }
      } catch (err) {
        setToast({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  if (choices.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No scenario bundles found under <code>scenarios/</code>.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Pick the ontology this deployment starts from. Each is a swappable bundle
        under <code>scenarios/&lt;name&gt;</code> — the AI grows it from there.
        {alreadyComplete
          ? " This deployment is already set up; installing again is locked."
          : ""}
      </p>
      <div className="space-y-2">
        {choices.map((c) => (
          <label
            key={c.name}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:border-ring has-checked:border-emerald-700"
          >
            <input
              type="radio"
              name="scenario"
              value={c.name}
              checked={selected === c.name}
              onChange={() => setSelected(c.name)}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                {c.name}
                {c.default ? " · default" : ""}
              </span>
              <span className="block text-xs text-muted-foreground">
                {c.description}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || alreadyComplete}
          onClick={install}
          className="rounded-md bg-emerald-700 hover:bg-emerald-600 text-emerald-50 text-xs font-semibold px-5 py-2 transition-colors disabled:opacity-50"
        >
          {pending
            ? "Installing…"
            : alreadyComplete
              ? "Already installed"
              : "Install scenario"}
        </button>
      </div>
      {toast.kind !== "idle" && (
        <p
          role="status"
          className={`mt-1 rounded border px-3 py-2 text-xs ${
            toast.kind === "ok"
              ? "border-emerald-800 bg-emerald-950/30 text-emerald-300"
              : "border-rose-800 bg-rose-950/30 text-rose-300"
          }`}
        >
          {toast.message}
        </p>
      )}
    </div>
  );
}
