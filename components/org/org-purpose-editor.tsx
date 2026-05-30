"use client";

// Steward-only inline editor for the organization's PURPOSE (its goal/telos —
// gap ② of the substrate spec). On save it calls the steward-gated
// saveOrgPurpose action, then router.refresh() so the board re-renders. The
// purpose is injected into the agent's reasoning context, so the agent weighs
// proposals + answers against it (rank by purpose, not just validate).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOrgPurpose } from "@/app/setup/actions";
import { ORG_PURPOSE_MAX } from "@/lib/org-profile/shared";

type Toast = { kind: "idle" } | { kind: "ok" } | { kind: "error"; message: string };

export function OrgPurposeEditor({ initialPurpose }: { initialPurpose: string }) {
  const router = useRouter();
  const [purpose, setPurpose] = useState(initialPurpose);
  const [toast, setToast] = useState<Toast>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveOrgPurpose(data);
      if (result.ok) {
        setPurpose(result.purpose);
        setToast({ kind: "ok" });
        router.refresh();
      } else {
        setToast({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label className="block">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
          Purpose — what this community optimizes for
        </span>
        <textarea
          name="purpose"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          maxLength={ORG_PURPOSE_MAX}
          rows={2}
          placeholder="e.g. keep beds full while protecting a calm, communal vibe"
          className="mt-1.5 w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-medium px-4 py-2 transition-colors disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save purpose"}
        </button>
        {toast.kind === "ok" && (
          <span role="status" className="text-xs text-emerald-400">
            Saved · the agent now weighs proposals against this
          </span>
        )}
        {toast.kind === "error" && (
          <span role="status" className="text-xs text-rose-400">
            {toast.message}
          </span>
        )}
      </div>
    </form>
  );
}
