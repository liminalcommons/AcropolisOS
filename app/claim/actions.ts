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

// #42: all failure branches return the same generic message to prevent
// code-enumeration (attacker cannot distinguish valid-but-claimed vs
// valid-but-expired vs unknown). The structured ClaimInviteFailureCode is
// kept internally for logging/metrics only and never reaches the UI.
const GENERIC_CLAIM_ERROR = "Invalid or expired invite code.";

// Server action invoked by the /claim form. Outcomes:
//   - success  → redirect("/signin?callbackUrl=/inbox") — no email param
//                (#43: email in URL lands in browser history + Referer chain).
//                (Programmatic NextAuth v5 signIn() from a server action
//                requires the cookie jar; the signin redirect is the simpler
//                reliable path and matches what existing setup wizard flows do.)
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
    await claimInvite({ code, password, userStore, db });
    // #43: drop the email query param — it would land in browser history and
    // the Referer chain. The user just set their password seconds ago; they
    // can type their email on the sign-in page. callbackUrl lands them in
    // /inbox after successful sign-in.
    redirect(`/signin?callbackUrl=/inbox`);
  } catch (err) {
    if (err instanceof ClaimInviteError) {
      // #42: return only the generic message — never expose the structured
      // code to the UI. Code is still available for server-side logging.
      return {
        ok: false,
        code: err.code,
        error: GENERIC_CLAIM_ERROR,
      };
    }
    // `redirect()` throws a NEXT_REDIRECT signal — re-throw so Next handles it.
    throw err;
  }
}
