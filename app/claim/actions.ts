"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { FileUserStore } from "@/lib/auth/users";
import { getUsersFile } from "@/lib/auth/config";
import { createPgOntologyStore } from "@/lib/ontology/pg-store";
import {
  claimInvite,
  ClaimInviteError,
  type ClaimInviteFailureCode,
} from "@/lib/claim/claim";

export interface ClaimFormState {
  ok: boolean;
  error?: string;
  code?: ClaimInviteFailureCode;
}

const ERROR_LABEL: Record<ClaimInviteFailureCode, string> = {
  not_found: "Unknown invite code.",
  expired: "This invite has expired. Ask a steward for a new one.",
  already_claimed:
    "This invite has already been claimed. Try signing in instead.",
};

// Server action invoked by the /claim form. Outcomes:
//   - success  → redirect("/signin?...&email=...") to let the user log in
//                with the password they just set. (Programmatic NextAuth v5
//                signIn() from a server action requires the cookie jar; the
//                signin redirect is the simpler reliable path and matches
//                what existing setup wizard flows do.)
//   - failure  → return ClaimFormState, page re-renders with the message.
export async function submitClaim(
  _prev: ClaimFormState | null,
  formData: FormData,
): Promise<ClaimFormState> {
  const code = String(formData.get("code") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!code) {
    return { ok: false, error: "Missing invite code." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const userStore = new FileUserStore(getUsersFile());
  const db = createPgOntologyStore(getDb());

  try {
    const { user } = await claimInvite({ code, password, userStore, db });
    redirect(
      `/signin?callbackUrl=/inbox&email=${encodeURIComponent(user.email)}`,
    );
  } catch (err) {
    if (err instanceof ClaimInviteError) {
      return {
        ok: false,
        code: err.code,
        error: ERROR_LABEL[err.code] ?? "Could not claim invite.",
      };
    }
    // `redirect()` throws a NEXT_REDIRECT signal — re-throw so Next handles it.
    throw err;
  }
}
