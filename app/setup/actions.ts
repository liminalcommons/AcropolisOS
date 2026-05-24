"use server";

// F1 setup-wizard server actions.
//
// saveLLMKey  — STUBBED this cycle. The key is NOT stored anywhere.
//               Secret-storage with envelope encryption lands next cycle.
//               Returns a plain object so the client can flash a toast.
//
// saveOrgProfile — FUNCTIONAL. Writes to uploads/org-profile.json which is
//                  bind-mounted into the container and persists across restarts.

import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";

// uploads/ is bind-mounted (see docker-compose.yml) — writes here survive
// container restarts. Never write secrets here; org-profile is public metadata.
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const ORG_PROFILE_PATH = path.join(UPLOADS_DIR, "org-profile.json");

// ─── saveLLMKey ──────────────────────────────────────────────────────────────

const SaveLLMKeyInput = z.object({
  key: z.string().min(1, "Key must not be empty"),
});

export type SaveLLMKeyResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function saveLLMKey(
  formData: FormData,
): Promise<SaveLLMKeyResult> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) {
    return { ok: false, error: "Not authenticated" };
  }

  const parsed = SaveLLMKeyInput.safeParse({ key: formData.get("key") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }

  // INTENTIONAL NO-OP — key is NOT persisted this cycle.
  // Secret-storage (envelope encryption, separate secrets table or HSM)
  // is its own cycle. Do not add persistence here without that infrastructure.

  return {
    ok: true,
    message: "Saved (stubbed — secret-storage lands next cycle)",
  };
}

// ─── saveOrgProfile ──────────────────────────────────────────────────────────

const SaveOrgProfileInput = z.object({
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
    description: formData.get("description"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }

  const payload = {
    description: parsed.data.description,
    updated_at: new Date().toISOString(),
    updated_by: runtime.actor?.email ?? "unknown",
  };

  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(ORG_PROFILE_PATH, JSON.stringify(payload, null, 2), "utf8");

  return { ok: true };
}
