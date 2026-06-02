"use client";
// M4.3: BlockerCard — renders a single AgentBlocker with resolution UI.
// Resolution modes:
//   - pathways: N curated paths with reversibility dots + Other + Dismiss escape hatches
//   - text_input: free-text/number/date input + Submit
//   - confirm_binary: Yes/No buttons
// Always includes a Dismiss escape hatch.

import type { BlockerPathway, InputSchema, ConfirmAction, ReasonKind, ResolutionMode } from "@/lib/me/widgets";

export interface BlockerCardProps {
  id: string;
  reason_kind: ReasonKind;
  summary: string;
  detail: string;
  blocked_work_ref: string | null;
  resolution_mode: ResolutionMode;
  pathways: BlockerPathway[] | null;
  input_schema: InputSchema | null;
  confirm_action: ConfirmAction | null;
  created_at: string;
  onResolveWithPathway?: (blockerId: string, pathwayId: string) => Promise<void>;
  onResolveWithInput?: (blockerId: string, inputPayload: string) => Promise<void>;
  onResolveWithCustom?: (blockerId: string, actionInvocation: string) => Promise<void>;
  onDismiss?: (blockerId: string, reason?: string) => Promise<void>;
}

const REASON_LABELS: Record<string, string> = {
  approval: "Approval",
  confirmation: "Confirmation",
  ambiguity: "Ambiguity",
  missing_data: "Missing data",
  consent: "Consent",
  decision: "Decision",
  risky_action: "Risky action",
};

const REASON_COLORS: Record<string, string> = {
  approval: "bg-amber-900/40 text-amber-300",
  confirmation: "bg-blue-900/40 text-blue-300",
  ambiguity: "bg-purple-900/40 text-purple-300",
  missing_data: "bg-red-900/40 text-red-300",
  consent: "bg-orange-900/40 text-orange-300",
  decision: "bg-violet-900/40 text-violet-300",
  risky_action: "bg-rose-900/40 text-rose-300",
};

const REVERSIBILITY_COLORS: Record<string, string> = {
  easy: "bg-success",
  moderate: "bg-warning",
  permanent: "bg-destructive",
};

function ReversibilityDot({ reversibility }: { reversibility: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${REVERSIBILITY_COLORS[reversibility] ?? "bg-muted-foreground"}`}
      title={`Reversibility: ${reversibility}`}
      aria-label={`Reversibility: ${reversibility}`}
    />
  );
}

function PathwaysResolution({
  id,
  pathways,
  onResolveWithPathway,
  onDismiss,
}: {
  id: string;
  pathways: BlockerPathway[];
  onResolveWithPathway?: (blockerId: string, pathwayId: string) => Promise<void>;
  onDismiss?: (blockerId: string, reason?: string) => Promise<void>;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
        Choose a path forward:
      </p>
      <ul className="space-y-1.5">
        {pathways.map((p) => (
          <li key={p.id} className="flex items-start gap-2">
            <ReversibilityDot reversibility={p.reversibility} />
            <button
              type="button"
              onClick={() => onResolveWithPathway?.(id, p.id)}
              className="text-left text-xs text-foreground hover:text-foreground"
            >
              <span className="font-medium">{p.label}</span>
              {" — "}
              <span className="text-muted-foreground">{p.rationale}</span>
            </button>
          </li>
        ))}
        {/* Other (write your own) escape hatch */}
        <li className="flex items-start gap-2">
          <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-secondary" title="Custom resolution" />
          <button
            type="button"
            onClick={() => {
              const custom = prompt("Describe your custom resolution (action type + params as JSON):");
              if (custom) onResolveWithPathway?.(id, "custom:" + custom);
            }}
            className="text-left text-xs text-muted-foreground hover:text-foreground"
          >
            Other (write your own)
          </button>
        </li>
      </ul>
      <button
        type="button"
        onClick={() => onDismiss?.(id)}
        className="mt-2 text-[10px] text-muted-foreground hover:text-foreground"
        data-testid={`dismiss-blocker-${id}`}
      >
        Dismiss this blocker
      </button>
    </div>
  );
}

function TextInputResolution({
  id,
  inputSchema,
  onResolveWithInput,
  onDismiss,
}: {
  id: string;
  inputSchema: InputSchema;
  onResolveWithInput?: (blockerId: string, inputPayload: string) => Promise<void>;
  onDismiss?: (blockerId: string, reason?: string) => Promise<void>;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs text-muted-foreground">{inputSchema.prompt}</label>
      <div className="flex gap-2">
        <input
          type={inputSchema.kind === "number" ? "number" : inputSchema.kind === "date" ? "date" : "text"}
          id={`input-${id}`}
          className="flex-1 rounded-md border border-border bg-input px-3 py-1.5 text-xs text-foreground"
          placeholder={inputSchema.prompt}
        />
        <button
          type="button"
          onClick={() => {
            const el = document.getElementById(`input-${id}`) as HTMLInputElement | null;
            if (el?.value) {
              onResolveWithInput?.(id, JSON.stringify({ value: el.value }));
            }
          }}
          data-testid={`submit-input-${id}`}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-[11px] font-medium text-emerald-50 hover:bg-emerald-600"
        >
          Submit
        </button>
      </div>
      <button
        type="button"
        onClick={() => onDismiss?.(id)}
        className="text-[10px] text-muted-foreground hover:text-foreground"
        data-testid={`dismiss-blocker-${id}`}
      >
        Dismiss
      </button>
    </div>
  );
}

function ConfirmBinaryResolution({
  id,
  confirmAction,
  onResolveWithInput,
  onDismiss,
}: {
  id: string;
  confirmAction: ConfirmAction;
  onResolveWithInput?: (blockerId: string, inputPayload: string) => Promise<void>;
  onDismiss?: (blockerId: string, reason?: string) => Promise<void>;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-foreground">{confirmAction.label}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onResolveWithInput?.(id, JSON.stringify({ confirmed: true }))}
          data-testid={`confirm-yes-${id}`}
          className="rounded-md bg-emerald-700 px-4 py-1.5 text-[11px] font-medium text-emerald-50 hover:bg-emerald-600"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onDismiss?.(id, "Declined")}
          data-testid={`confirm-no-${id}`}
          className="rounded-md bg-secondary px-4 py-1.5 text-[11px] font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          No
        </button>
      </div>
    </div>
  );
}

export function BlockerCard({
  id,
  reason_kind,
  summary,
  detail,
  blocked_work_ref,
  resolution_mode,
  pathways,
  input_schema,
  confirm_action,
  created_at,
  onResolveWithPathway,
  onResolveWithInput,
  onDismiss,
}: BlockerCardProps) {
  return (
    <li
      id={`blocker-${id}`}
      data-testid={`blocker-card-${id}`}
      className="rounded-md border border-border bg-card/60 p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`pill text-[10px] px-2 py-0.5 rounded font-mono ${
                REASON_COLORS[reason_kind] ?? "bg-secondary text-secondary-foreground"
              }`}
            >
              {REASON_LABELS[reason_kind] ?? reason_kind}
            </span>
            <span className="font-medium text-sm text-foreground">{summary}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{detail}</p>
          {blocked_work_ref && (
            <p className="mt-1 text-[10px] font-mono text-muted-foreground">ref: {blocked_work_ref}</p>
          )}
          <time className="mt-1 block text-[10px] text-muted-foreground">{created_at.replace("T", " ").slice(0, 16)}</time>
        </div>
      </div>

      {/* Resolution UI */}
      <div className="pt-2 border-t border-border">
        {resolution_mode === "pathways" && pathways && pathways.length > 0 && (
          <PathwaysResolution
            id={id}
            pathways={pathways}
            onResolveWithPathway={onResolveWithPathway}
            onDismiss={onDismiss}
          />
        )}
        {resolution_mode === "text_input" && input_schema && (
          <TextInputResolution
            id={id}
            inputSchema={input_schema}
            onResolveWithInput={onResolveWithInput}
            onDismiss={onDismiss}
          />
        )}
        {resolution_mode === "confirm_binary" && confirm_action && (
          <ConfirmBinaryResolution
            id={id}
            confirmAction={confirm_action}
            onResolveWithInput={onResolveWithInput}
            onDismiss={onDismiss}
          />
        )}
        {/* Fallback: simple resolve button for pathways mode without pathways */}
        {resolution_mode === "pathways" && (!pathways || pathways.length === 0) && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onResolveWithPathway?.(id, "00000000-0000-0000-0000-000000000000")}
              data-testid={`resolve-blocker-${id}`}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-[11px] font-medium text-emerald-50 hover:bg-emerald-600"
            >
              Resolve
            </button>
            <button
              type="button"
              onClick={() => onDismiss?.(id)}
              data-testid={`dismiss-blocker-${id}`}
              className="rounded-md bg-secondary px-3 py-1.5 text-[11px] font-medium text-secondary-foreground hover:bg-secondary/80"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
