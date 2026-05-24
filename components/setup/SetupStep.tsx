"use client";

// SetupStep — collapsible card used in the /setup first-run wizard.
//
// Visual language: calm zinc palette (bg-zinc-900/30, border-zinc-800)
// matching the storyboard frame 1 vertical-stack layout.
//
// Status indicators:
//   ok      → emerald-400 checkmark circle
//   fail    → rose-400 ✕ circle
//   pending → zinc-500 number badge

import { useState, type ReactNode } from "react";

export type StepStatus = "ok" | "fail" | "pending";

interface SetupStepProps {
  step: number;
  title: string;
  status?: StepStatus;
  defaultExpanded?: boolean;
  children: ReactNode;
}

function StatusBadge({ step, status }: { step: number; status: StepStatus }) {
  if (status === "ok") {
    return (
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center mt-0.5">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2 6l3 3 5-5"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-rose-700/60 border border-rose-600 flex items-center justify-center mt-0.5">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path
            d="M2 2l6 6M8 2l-6 6"
            stroke="#f87171"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  // pending
  return (
    <span className="flex-shrink-0 w-6 h-6 rounded-full border-2 border-zinc-600 flex items-center justify-center mt-0.5">
      <span className="text-[10px] font-bold text-zinc-500 leading-none">
        {step}
      </span>
    </span>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      className={`text-zinc-600 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
    >
      <path
        d="M3 5l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SetupStep({
  step,
  title,
  status = "pending",
  defaultExpanded = true,
  children,
}: SetupStepProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const headerTextColor =
    status === "ok"
      ? "text-zinc-400"
      : status === "fail"
        ? "text-rose-300"
        : "text-zinc-100";

  const borderColor =
    status === "fail"
      ? "border-rose-800/60"
      : expanded && status !== "ok"
        ? "border-emerald-800/50"
        : "border-zinc-800";

  const bgColor =
    status === "fail"
      ? "bg-rose-950/10"
      : expanded && status !== "ok"
        ? "bg-emerald-950/5"
        : "bg-zinc-900/30";

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-5`}>
      {/* Header row — always visible, click to toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 text-left"
        aria-expanded={expanded}
      >
        <StatusBadge step={step} status={status} />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-zinc-600 leading-none mb-1">
            Step {step}
          </p>
          <p className={`text-sm font-semibold ${headerTextColor} leading-snug`}>
            {title}
          </p>
        </div>
        <ChevronIcon expanded={expanded} />
      </button>

      {/* Collapsible body */}
      {expanded && (
        <div className="mt-4 pl-9">{children}</div>
      )}
    </div>
  );
}
