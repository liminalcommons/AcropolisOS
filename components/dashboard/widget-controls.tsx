// components/dashboard/widget-controls.tsx
"use client";

import { useState, useTransition } from "react";
import { ArrowUp, ArrowDown, X, Plus, Settings2, RotateCcw } from "lucide-react";
import {
  moveWidgetAction,
  removeWidgetAction,
  addWidgetAction,
  resetArrangementAction,
} from "@/app/arrange-actions";

export interface ArrangeWidgetRow {
  id: string;
  label: string;
}
export interface AddableRow {
  index: number;
  label: string;
}

export function WidgetControls({
  widgets,
  addable,
}: {
  widgets: ArrangeWidgetRow[];
  addable: AddableRow[];
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition-colors ${
            editing ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {editing ? "Done arranging" : "Arrange"}
        </button>
        {editing && (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => resetArrangementAction())}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to default
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-3 space-y-3 rounded-lg border border-border bg-card p-3">
          <ul className="space-y-1.5">
            {widgets.map((w, i) => (
              <li
                key={w.id}
                className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground"
              >
                <span className="truncate">{w.label}</span>
                <span className="flex items-center gap-1">
                  <IconBtn
                    label="Move up"
                    disabled={pending || i === 0}
                    onClick={() => startTransition(() => moveWidgetAction(w.id, "up"))}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Move down"
                    disabled={pending || i === widgets.length - 1}
                    onClick={() => startTransition(() => moveWidgetAction(w.id, "down"))}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Remove"
                    disabled={pending}
                    onClick={() => startTransition(() => removeWidgetAction(w.id))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </IconBtn>
                </span>
              </li>
            ))}
          </ul>

          {addable.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Add from your catalog
              </p>
              <div className="flex flex-wrap gap-1.5">
                {addable.map((a) => (
                  <button
                    key={a.index}
                    type="button"
                    disabled={pending}
                    onClick={() => startTransition(() => addWidgetAction(a.index))}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" /> {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}
