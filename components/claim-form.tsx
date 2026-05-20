"use client";

import { useActionState } from "react";
import { submitClaim, type ClaimFormState } from "@/app/claim/actions";

const initialState: ClaimFormState | null = null;

export function ClaimForm({ code }: { code: string }) {
  const [state, formAction, pending] = useActionState<
    ClaimFormState | null,
    FormData
  >(submitClaim, initialState);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <input type="hidden" name="code" value={code} readOnly />
      {state?.error ? (
        <p
          role="alert"
          className="rounded border border-red-700 bg-red-900/30 p-3 text-sm"
        >
          {state.error}
        </p>
      ) : null}
      <label className="block text-sm">
        Choose a password
        <input
          type="password"
          name="password"
          minLength={8}
          required
          autoComplete="new-password"
          autoFocus
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2"
        />
        <span className="mt-1 block text-xs text-zinc-500">
          At least 8 characters.
        </span>
      </label>
      <button
        type="submit"
        disabled={pending || !code}
        className="rounded bg-zinc-100 px-4 py-2 text-zinc-900 disabled:opacity-50"
      >
        {pending ? "Claiming…" : "Claim invite"}
      </button>
    </form>
  );
}
