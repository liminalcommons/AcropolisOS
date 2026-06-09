// lib/auth/steward.ts
//
// Steward identity mapping for SSO. With Logto as the identity provider the
// app no longer stores per-user roles locally — instead a single env list,
// STEWARD_EMAILS, names the steward identities. Everyone else who signs in via
// Logto is a "member". PURE + env-free: the caller reads the env once and
// passes the raw string in, so this stays unit-lockable and clock-free.
//
// Matching is case-insensitive and trim-tolerant (operators paste emails with
// stray spaces / mixed case). Empty / unset → no stewards (fail-closed: a
// misconfigured deploy grants nobody steward, never everybody).

export type AppRole = "steward" | "member";

/**
 * Parse the STEWARD_EMAILS env value (comma- and/or whitespace-separated) into
 * a normalized lookup set. Blank entries are dropped; each email is lowercased
 * and trimmed so membership tests are case-insensitive.
 */
export function parseStewardEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

/**
 * Resolve an authenticated email to its app role. Steward iff the (normalized)
 * email is in the steward set; otherwise member. A missing/blank email is a
 * member (never a steward) — fail-closed.
 */
export function resolveRole(
  email: string | null | undefined,
  stewards: Set<string>,
): AppRole {
  if (!email) return "member";
  return stewards.has(email.trim().toLowerCase()) ? "steward" : "member";
}
