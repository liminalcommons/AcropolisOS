// Org-profile pure helpers — constants, types, and validators with NO Node
// built-ins (no node:fs / node:path). Safe to import from CLIENT components.
//
// The fs-backed read/write lives in ./store (server-only). Keeping the pure
// surface here lets a "use client" component import e.g. ORG_NAME_MAX without
// dragging node:fs/promises into the browser bundle (Turbopack rejects that).

export const ORG_NAME_FALLBACK = "acropolis";
export const ORG_NAME_MAX = 80;

export interface OrgProfile {
  name?: string;
  description?: string;
  updated_at?: string;
  updated_by?: string;
}

// The community's name for the shell, or the product brand when unset.
export function resolveOrgDisplayName(profile: OrgProfile | null | undefined): string {
  const name = profile?.name?.trim();
  return name ? name : ORG_NAME_FALLBACK;
}

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

// Patch wins per-field; a null existing profile is treated as empty. Patching
// one field (name) never clobbers another (description).
export function mergeProfile(existing: OrgProfile | null, patch: Partial<OrgProfile>): OrgProfile {
  return { ...(existing ?? {}), ...patch };
}
