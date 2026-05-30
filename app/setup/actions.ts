"use server";

// F1 setup-wizard server actions.
//
// saveOrgProfile — FUNCTIONAL. Writes to uploads/org-profile.json which is
//                  bind-mounted into the container and persists across restarts.
//
// The BYOK LLM key now persists via POST /api/setup/provider (validated against
// the provider + written to .env); the steward is created via POST
// /api/setup/steward. The old stubbed saveLLMKey no-op was deleted (Clean-Break).

import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { validateOrgName } from "@/lib/org-profile/shared";
import { writeOrgProfile } from "@/lib/org-profile/store";
import { z } from "zod";

// ─── saveOrgProfile ──────────────────────────────────────────────────────────

const SaveOrgProfileInput = z.object({
  name: z
    .string()
    .min(1, "Name must not be empty")
    .max(80, "Name must be 80 characters or fewer"),
  description: z
    .string()
    .min(1, "Description must not be empty")
    .max(1000, "Description must be 1000 characters or fewer"),
});

export type SaveOrgProfileResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveOrgProfile(
  formData: FormData,
): Promise<SaveOrgProfileResult> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) {
    return { ok: false, error: "Not authenticated" };
  }

  const parsed = SaveOrgProfileInput.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }

  await writeOrgProfile(
    { name: parsed.data.name.trim(), description: parsed.data.description },
    { updated_by: runtime.actor?.email ?? "unknown" },
  );

  return { ok: true };
}

// ─── saveOrgName ───────────────────────────────────────────────────────────────
//
// Steward-only rename — the "editable anytime" path (decision 2026-05-28).
// Changing the org's public identity is a steward act, so it gates on role
// beyond mere authentication (mirrors the /org page gate). Merges into the
// existing profile so the description is preserved.

export type SaveOrgNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

export async function saveOrgName(formData: FormData): Promise<SaveOrgNameResult> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) {
    return { ok: false, error: "Not authenticated" };
  }
  if (runtime.actor?.role !== "steward") {
    return { ok: false, error: "Only stewards can rename the organization" };
  }

  const validated = validateOrgName(formData.get("name"));
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  await writeOrgProfile(
    { name: validated.value },
    { updated_by: runtime.actor?.email ?? "unknown" },
  );

  return { ok: true, name: validated.value };
}
