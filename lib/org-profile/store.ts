// Org-profile persistence — the single org's public metadata (name + description).
//
// SINGLE ORG (decision 2026-05-28): acropolisOS is one community per deployment.
// The profile is file-backed JSON under uploads/ (bind-mounted — survives
// container restarts; the SAME pattern as org-dashboard.json). Never store
// secrets here; this is public metadata shown in the shell.
//
// The display name shown in the shell sidebar falls back to the product brand
// when the steward has not named the org yet.

import path from "node:path";
import fs from "node:fs/promises";

export const ORG_NAME_FALLBACK = "acropolis";
export const ORG_NAME_MAX = 80;

export interface OrgProfile {
  name?: string;
  description?: string;
  updated_at?: string;
  updated_by?: string;
}

// uploads/ is bind-mounted (see docker-compose.yml). Same dir as org-dashboard.json.
const DEFAULT_PATH = path.join(process.cwd(), "uploads", "org-profile.json");

// ── resolveOrgDisplayName ───────────────────────────────────────────────────────
// The community's name for the shell, or the product brand when unset.
export function resolveOrgDisplayName(profile: OrgProfile | null | undefined): string {
  const name = profile?.name?.trim();
  return name ? name : ORG_NAME_FALLBACK;
}

// ── validateOrgName ─────────────────────────────────────────────────────────────
export function validateOrgName(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Name must be text" };
  }
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, error: "Name must not be empty" };
  }
  if (value.length > ORG_NAME_MAX) {
    return { ok: false, error: `Name must be ${ORG_NAME_MAX} characters or fewer` };
  }
  return { ok: true, value };
}

// ── mergeProfile ────────────────────────────────────────────────────────────────
// Patch wins per-field; a null existing profile is treated as empty. Patching one
// field (name) never clobbers another (description).
export function mergeProfile(existing: OrgProfile | null, patch: Partial<OrgProfile>): OrgProfile {
  return { ...(existing ?? {}), ...patch };
}

// ── readOrgProfile ──────────────────────────────────────────────────────────────
// Returns the persisted profile, or null when absent / corrupt (never throws).
export async function readOrgProfile(filePath: string = DEFAULT_PATH): Promise<OrgProfile | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as OrgProfile;
    }
  } catch {
    // corrupt JSON — treat as absent
  }
  return null;
}

// ── writeOrgProfile ─────────────────────────────────────────────────────────────
// Read-merge-write: applies the patch over the existing profile and stamps
// metadata. Returns the written profile.
export async function writeOrgProfile(
  patch: Partial<OrgProfile>,
  meta: { updated_by: string },
  filePath: string = DEFAULT_PATH,
): Promise<OrgProfile> {
  const existing = await readOrgProfile(filePath);
  const next = mergeProfile(existing, {
    ...patch,
    updated_at: new Date().toISOString(),
    updated_by: meta.updated_by,
  });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
