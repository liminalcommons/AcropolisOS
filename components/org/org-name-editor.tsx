"use client";

// Steward-only inline editor for the organization name (editable-anytime path,
// decision 2026-05-28). On save it calls the steward-gated saveOrgName action,
// then router.refresh() so the shell sidebar (a server component) re-renders
// with the new identity without a manual reload.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOrgName } from "@/app/setup/actions";
import { ORG_NAME_MAX } from "@/lib/org-profile/shared";

type Toast = { kind: "idle" } | { kind: "ok" } | { kind: "error"; message: string };

export function OrgNameEditor({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [toast, setToast] = useState<Toast>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveOrgName(data);
      if (result.ok) {
        setName(result.name);
        setToast({ kind: "ok" });
        router.refresh();
      } else {
        setToast({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <label className="block flex-1">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
          Organization name
        </span>
        <input
          type="text"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={ORG_NAME_MAX}
          placeholder="e.g. Casa Verde"
          className="mt-1.5 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-medium px-4 py-2 transition-colors disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {toast.kind === "ok" && (
        <span role="status" className="pb-2 text-xs text-success">Saved</span>
      )}
      {toast.kind === "error" && (
        <span role="status" className="pb-2 text-xs text-destructive">{toast.message}</span>
      )}
    </form>
  );
}
