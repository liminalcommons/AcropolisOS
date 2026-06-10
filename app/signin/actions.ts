"use server";

import { signIn } from "@/lib/auth";

/**
 * Logto door as a server action. Auth.js's server-side signIn() owns the
 * CSRF handshake, so this works for a completely fresh browser — unlike a
 * hand-rolled POST to /api/auth/signin/logto, which needs an authjs.csrf-token
 * cookie that nothing on /signin ever set (=> MissingCSRF for new visitors).
 *
 * Only relative paths are honored as redirect targets; anything else falls
 * back to /chat so a crafted ?callbackUrl can't bounce users off-site.
 */
export async function signInWithLogto(formData: FormData): Promise<void> {
  const raw = formData.get("callbackUrl");
  const callbackUrl =
    typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")
      ? raw
      : "/chat";
  await signIn("logto", { redirectTo: callbackUrl });
}
