// Org-profile persistence — the single org's public metadata (name + description).
//
// SINGLE ORG (decision 2026-05-28): acropolisOS is one community per deployment.
// The profile is file-backed JSON under uploads/ (bind-mounted — survives
// container restarts; the SAME pattern as org-dashboard.json). Never store
// secrets here; this is public metadata shown in the shell.
//
// SERVER-ONLY: this module imports node:fs. Pure constants/validators/types
// (ORG_NAME_MAX, validateOrgName, resolveOrgDisplayName, OrgProfile, …) live in
// ./shared so client components can import them without pulling in node:fs.

import path from "node:path";
import fs from "node:fs/promises";
import { type OrgProfile, mergeProfile } from "./shared";

// uploads/ is bind-mounted (see docker-compose.yml). Same dir as org-dashboard.json.
const DEFAULT_PATH = path.join(process.cwd(), "uploads", "org-profile.json");

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
