// Generated CRUD form — inputs derived from the ontology FormField list, typed
// by kind. Calls a bound server action (create/update) and shows the result.
// Read-only of structure; the server action is the write boundary (fenced).
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FormField } from "@/lib/ontology/object-form";

type CrudResult = { ok: true; id?: string } | { ok: false; error: string };

function FieldInput({ field, initial }: { field: FormField; initial?: unknown }) {
  const base =
    "mt-1 w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring transition-colors";
  const val = initial === null || initial === undefined ? "" : String(initial);
  if (field.kind === "enum" && field.enumValues) {
    return (
      <select name={field.name} defaultValue={val} className={base}>
        {!field.required && <option value="">—</option>}
        {field.enumValues.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "boolean") {
    return (
      <input
        type="checkbox"
        name={field.name}
        defaultChecked={initial === true || initial === "true"}
        className="mt-1.5 h-4 w-4 accent-emerald-600"
      />
    );
  }
  const type =
    field.kind === "date"
      ? "date"
      : field.kind === "integer" || field.kind === "decimal"
        ? "number"
        : field.kind === "email"
          ? "email"
          : "text";
  return (
    <input
      type={type}
      name={field.name}
      defaultValue={val}
      step={field.kind === "decimal" ? "any" : undefined}
      required={field.required}
      placeholder={field.kind === "timestamp" ? "ISO timestamp" : field.refTarget ? `${field.refTarget} id` : undefined}
      className={base}
    />
  );
}

export function ObjectForm({
  fields,
  initial,
  submitLabel,
  action,
  afterSuccessHref,
}: {
  fields: FormField[];
  initial?: Record<string, unknown>;
  submitLabel: string;
  action: (values: Record<string, string>) => Promise<CrudResult>;
  afterSuccessHref?: string;
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    for (const f of fields) {
      values[f.name] = f.kind === "boolean" ? (fd.get(f.name) ? "true" : "false") : String(fd.get(f.name) ?? "");
    }
    startTransition(async () => {
      const r = await action(values);
      if (r.ok) {
        setMsg({ kind: "ok", text: "Saved." });
        if (afterSuccessHref) router.push(afterSuccessHref);
        else router.refresh();
      } else {
        setMsg({ kind: "error", text: r.error });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.name} className="block text-xs">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {f.name}
              {f.required && <span className="text-destructive"> *</span>}
              <span className="ml-1 normal-case opacity-50">· {f.kind}</span>
            </span>
            <FieldInput field={f} initial={initial?.[f.name]} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-700 hover:bg-emerald-600 text-emerald-50 text-xs font-semibold px-4 py-2 transition-colors disabled:opacity-50"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {msg && (
          <span className={`text-xs ${msg.kind === "ok" ? "text-success" : "text-destructive"}`}>{msg.text}</span>
        )}
      </div>
    </form>
  );
}

// Delete affordance — a small confirm-then-act button bound to a delete action.
export function DeleteButton({
  action,
  afterHref,
  label = "Delete",
}: {
  action: () => Promise<CrudResult>;
  afterHref: string;
  label?: string;
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    if (!armed) {
      setArmed(true);
      return;
    }
    startTransition(async () => {
      const r = await action();
      if (r.ok) router.push(afterHref);
      else {
        setErr(r.error);
        setArmed(false);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-rose-800 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-950/30 transition-colors disabled:opacity-50"
      >
        {pending ? "Deleting…" : armed ? "Click again to confirm" : label}
      </button>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </span>
  );
}
