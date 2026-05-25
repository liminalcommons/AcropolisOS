"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";

interface ReviewerProps {
  proposalId: string;
  sessionId: string;
  status: string;
  createdAt: string;
  impactedTables: string[];
  currentYaml: string;
  proposedYaml: string;
}

type Action = "apply" | "reject" | "save" | null;

export function ProposalReviewer({
  proposalId,
  sessionId,
  status,
  createdAt,
  impactedTables,
  currentYaml,
  proposedYaml,
}: ReviewerProps): React.ReactElement {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftYaml, setDraftYaml] = useState(proposedYaml);
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);

  const post = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`/api/proposals/${proposalId}${path}`, {
      method: "POST",
      ...init,
    });

  const handleApply = (): void => {
    setActiveAction("apply");
    setError(null);
    startTransition(async () => {
      const res = await post("/apply");
      if (!res.ok) {
        setError(`apply failed (${res.status})`);
        setActiveAction(null);
        return;
      }
      router.push("/proposals");
      router.refresh();
    });
  };

  const handleReject = (): void => {
    setActiveAction("reject");
    setError(null);
    startTransition(async () => {
      const res = await post("/reject");
      if (!res.ok) {
        setError(`reject failed (${res.status})`);
        setActiveAction(null);
        return;
      }
      router.push("/proposals");
      router.refresh();
    });
  };

  const handleSave = (): void => {
    setActiveAction("save");
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yaml_diff: draftYaml }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(`save failed (${res.status}): ${body.error ?? "unknown"}`);
        setActiveAction(null);
        return;
      }
      setEditing(false);
      setActiveAction(null);
      router.refresh();
    });
  };

  const handleCancel = (): void => {
    setDraftYaml(proposedYaml);
    setEditing(false);
    setError(null);
  };

  return (
    <main>
      <div className="mx-auto max-w-6xl px-8 py-12">
        <div className="flex items-baseline justify-between">
          <div>
            <Link
              href="/proposals"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ← back to queue
            </Link>
            <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
              proposal {proposalId.slice(0, 8)}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              session <span className="text-foreground">{sessionId}</span> · status{" "}
              <span className="text-foreground">{status}</span> · created{" "}
              <time dateTime={createdAt}>{createdAt}</time>
            </p>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={pending}
                  data-testid="proposal-save"
                  className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
                >
                  {activeAction === "save" ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={pending}
                  data-testid="proposal-cancel"
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-card disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={pending || status !== "pending"}
                  data-testid="proposal-apply"
                  className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
                >
                  {activeAction === "apply" ? "Applying…" : "Apply"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  disabled={pending || status !== "pending"}
                  data-testid="proposal-edit"
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-card disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={pending || status !== "pending"}
                  data-testid="proposal-reject"
                  className="rounded-md border border-destructive/60 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  {activeAction === "reject" ? "Rejecting…" : "Reject"}
                </button>
              </>
            )}
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Preview impact
          </h2>
          {impactedTables.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No object tables are impacted by this proposal.
            </p>
          ) : (
            <ul
              data-testid="impacted-tables"
              className="mt-2 flex flex-wrap gap-2"
            >
              {impactedTables.map((t) => (
                <li
                  key={t}
                  className="rounded-md border border-border bg-card px-2 py-1 font-mono text-xs text-foreground"
                >
                  {t}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current
            </h3>
            <pre
              data-testid="diff-current"
              className="mt-2 max-h-[60vh] overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground"
            >
              {currentYaml}
            </pre>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Proposed
            </h3>
            {editing ? (
              <textarea
                data-testid="diff-editor"
                value={draftYaml}
                onChange={(e) => setDraftYaml(e.target.value)}
                spellCheck={false}
                className="mt-2 h-[60vh] w-full rounded-md border border-emerald-800 bg-background p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-emerald-700"
              />
            ) : (
              <pre
                data-testid="diff-proposed"
                className="mt-2 max-h-[60vh] overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-emerald-200"
              >
                {proposedYaml}
              </pre>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
