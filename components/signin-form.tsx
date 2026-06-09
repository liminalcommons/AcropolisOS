"use client";

import { useState } from "react";
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

  // Initiate the Logto OIDC flow with the SAME CSRF form-POST that Auth.js's
  // own client does, but without depending on next-auth/react's signIn() — that
  // helper was not navigating from this page (the button looked dead). A plain
  // form submit is a real top-level navigation the browser always honors.
  async function startLogto(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/csrf", { credentials: "same-origin" });
      const { csrfToken } = (await res.json()) as { csrfToken: string };
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/auth/signin/logto";
      const add = (name: string, value: string): void => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      };
      add("csrfToken", csrfToken);
      add("callbackUrl", callbackUrl);
      document.body.appendChild(form);
      form.submit();
    } catch {
      setBusy(false); // let the user retry; the page stays put
    }
  }

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
          onClick={() => void startLogto()}
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
