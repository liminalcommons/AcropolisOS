"use server";

import { signOut } from "./index";

// Sign out the current user and return to /signin. Wired into the shell header
// (was missing entirely — no sign-out control existed in the UI).
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/signin" });
}
