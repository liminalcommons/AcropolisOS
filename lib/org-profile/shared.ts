// Org-profile pure helpers — constants, types, and validators with NO Node
// built-ins (no node:fs / node:path). Safe to import from CLIENT components.
//
// The fs-backed read/write lives in ./store (server-only). Keeping the pure
// surface here lets a "use client" component import e.g. ORG_NAME_MAX without
// dragging node:fs/promises into the browser bundle (Turbopack rejects that).

export const ORG_NAME_FALLBACK = "acropolis";
export const ORG_NAME_MAX = 80;
// A purpose is a sentence ("why this org exists / what it optimizes for"), not a
// label — so it caps larger than the name but smaller than the freeform description.
export const ORG_PURPOSE_MAX = 280;

export interface OrgProfile {
  name?: string;
  description?: string;
  // The org's GOAL/telos — a steward-authored objective the AI weighs proposals
  // and answers against (rank by purpose, not just validate). Injected into the
  // agent's reasoning context when set; absent = the AI reasons without it.
  purpose?: string;
  updated_at?: string;
  updated_by?: string;
}

// The community's name for the shell, or the product brand when unset.
export function resolveOrgDisplayName(profile: OrgProfile | null | undefined): string {
  const name = profile?.name?.trim();
  return name ? name : ORG_NAME_FALLBACK;
}

// The org's purpose, trimmed, or "" when unset. Callers skip injection on "".
export function resolveOrgPurpose(profile: OrgProfile | null | undefined): string {
  return profile?.purpose?.trim() ?? "";
}

// The system-prompt preamble that injects the org purpose into the agent's
// reasoning so it weighs options by fit-to-purpose (rank, not just validate).
// Empty string when no purpose is set — the agent then reasons without it. Pure;
// the chat route prepends this to the static AGENT_INSTRUCTIONS.
export function orgPurposePreamble(purpose: string | null | undefined): string {
  const p = purpose?.trim();
  if (!p) return "";
  return (
    `This organization's stated PURPOSE is: "${p}". ` +
    `When you propose structure, views, or actions — or answer questions — weigh the ` +
    `options by how well they serve this purpose: prefer what advances it, and call out ` +
    `anything that conflicts with it. `
  );
}

export function validateOrgPurpose(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Purpose must be text" };
  }
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, error: "Purpose must not be empty" };
  }
  if (value.length > ORG_PURPOSE_MAX) {
    return { ok: false, error: `Purpose must be ${ORG_PURPOSE_MAX} characters or fewer` };
  }
  return { ok: true, value };
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
