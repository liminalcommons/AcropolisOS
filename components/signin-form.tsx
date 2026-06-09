"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

/**
 * The sign-in surface. The ONLY public door is Logto SSO ("Continue with
 * Logto"); the password form is gone. When Logto is not configured the parent
 * renders a break-glass notice instead of this button, so `logtoEnabled` gates
 * whether the button is shown at all.
 */
export function SignInForm({ logtoEnabled }: { logtoEnabled: boolean }) {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/chat";
  const errorParam = params.get("error");
  const [busy, setBusy] = useState(false);

  const error =
    errorParam === "magiclink"
      ? "That sign-in link is invalid or has expired. Ask for a fresh one."
      : errorParam === "Configuration"
        ? "Sign-in is misconfigured. The steward needs to check the Logto setup."
        : errorParam
          ? "Sign-in failed. Please try again."
          : null;

  return (
    <div className="mt-8 space-y-4">
      {error ? (
        <p
          role="alert"
          className="rounded border border-destructive/60 bg-destructive/15 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {logtoEnabled ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signIn("logto", { callbackUrl });
          }}
          className="w-full rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Redirecting…" : "Continue with Logto"}
        </button>
      ) : (
        <p className="rounded border border-border bg-card p-3 text-sm text-muted-foreground">
          Public sign-in isn’t configured yet. Access is via an operator
          sign-in link for now.
        </p>
      )}
    </div>
  );
}
