"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export function SignInForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/chat";
  const errorParam = params.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam === "CredentialsSignin"
      ? "Invalid email or password."
      : errorParam
        ? "Sign-in failed. Please try again."
        : null,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    if (res?.error) {
      setError(
        res.error === "CredentialsSignin"
          ? "Invalid email or password."
          : "Sign-in failed.",
      );
      setBusy(false);
      return;
    }
    window.location.href = res?.url ?? callbackUrl;
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-4">
      {error ? (
        <p
          role="alert"
          className="rounded border border-red-700 bg-red-900/30 p-3 text-sm"
        >
          {error}
        </p>
      ) : null}
      <label className="block text-sm">
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          autoFocus
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2"
        />
      </label>
      <label className="block text-sm">
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-zinc-100 px-4 py-2 text-zinc-900 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
