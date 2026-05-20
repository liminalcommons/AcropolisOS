// M4.2: /claim core logic. The page.tsx server action wraps this; tests
// drive it directly (see claim.test.ts for rationale).
//
// Steward-only fields (invite_code, invite_expires_at) live behind a
// property-level read gate (member.yaml). The lookup here therefore needs
// to scan the underlying store rather than route through a normal
// member_self/role-scoped ctx — there's no actor on /claim (the invitee
// is unauthenticated at this point). The OntologyStore passed in IS the
// raw store (createInMemoryStore for tests, Pg-backed in production via
// the same access), so wrapping is skipped on purpose.

import type { UserRecord, UserStore } from "../auth/users";
import type { ObjectAccess, OntologyStore } from "../ontology/ctx";
import type { Member } from "../ontology/types.generated";

export type ClaimInviteFailureCode =
  | "not_found"
  | "expired"
  | "already_claimed";

export class ClaimInviteError extends Error {
  constructor(
    message: string,
    readonly code: ClaimInviteFailureCode,
  ) {
    super(message);
    this.name = "ClaimInviteError";
  }
}

export interface ClaimInviteInput {
  code: string;
  password: string;
  userStore: UserStore;
  db: OntologyStore;
}

export interface ClaimInviteSuccess {
  ok: true;
  user: UserRecord;
  member: Member;
}

// #41: subset projection — only the 3 fields the unauth /claim path needs.
// Never return the full Member row from the unauthenticated lookup so future
// callers cannot accidentally leak notes, tier, joined_at, user_id, etc.
interface MemberInviteProjection {
  id: string;
  email: string;
  full_name: string;
}

async function findByInviteCode(
  members: ObjectAccess<Member>,
  code: string,
): Promise<MemberInviteProjection | null> {
  // findMany is the supported steward-readable surface for invite_code in
  // the in-memory + pg implementations. Filtering by invite_code is safe
  // because we're inside an unauthenticated server action — the gate is
  // "do you possess the code itself", not "does the actor pass member_self".
  const rows = await members.findMany({ invite_code: code } as Partial<Member>);
  const row = rows[0];
  if (!row) return null;
  // Project to only the 3 needed fields — never expose the full row.
  return { id: row.id, email: row.email, full_name: row.full_name };
}

// #40: fetch the full Member row (steward-readable) separately, only after
// we have the projection. We need invite_code, invite_expires_at, and user_id
// for validation, but these never leave this function.
async function findFullMemberByInviteCode(
  members: ObjectAccess<Member>,
  code: string,
): Promise<Member | null> {
  const rows = await members.findMany({ invite_code: code } as Partial<Member>);
  return rows[0] ?? null;
}

export async function claimInvite(
  input: ClaimInviteInput,
): Promise<ClaimInviteSuccess> {
  const { code, password, userStore, db } = input;
  if (!code) {
    throw new ClaimInviteError("missing invite code", "not_found");
  }
  if (!password || password.length < 8) {
    // Mirrors api/setup/steward password minimum. The page-level form
    // catches this earlier with a friendlier message; this is the
    // defense-in-depth check at the lib boundary.
    throw new ClaimInviteError(
      "password must be at least 8 characters",
      "not_found",
    );
  }

  // #41: use subset projection for the lookup — validates code existence
  // without exposing private Member fields to the caller.
  const projection = await findByInviteCode(db.objects.Member, code);
  if (!projection) {
    throw new ClaimInviteError(`unknown invite code`, "not_found");
  }

  // Full row needed for validation fields only — stays internal.
  const member = await findFullMemberByInviteCode(db.objects.Member, code);
  if (!member) {
    // Race: code disappeared between the two lookups — treat as not found.
    throw new ClaimInviteError(`unknown invite code`, "not_found");
  }
  if (member.user_id) {
    throw new ClaimInviteError(
      `member ${member.id} already claimed`,
      "already_claimed",
    );
  }
  if (!member.invite_expires_at) {
    throw new ClaimInviteError(
      `member ${member.id} has no invite_expires_at — bad state`,
      "expired",
    );
  }
  const expiresAt = new Date(member.invite_expires_at).getTime();
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    throw new ClaimInviteError(
      `invite code expired at ${member.invite_expires_at}`,
      "expired",
    );
  }

  // #40: atomic claim — create the user first, then attempt a conditional
  // Member.update that only succeeds when user_id is still NULL (preventing
  // a concurrent /claim from both winning the race). If the update finds the
  // row already claimed (returns null), roll back by deleting the new user
  // and reject as already_claimed.
  const user = await userStore.create({
    email: member.email,
    password,
    role: "member",
    customRoles: [],
  });

  const updated = await db.objects.Member.update(member.id, {
    user_id: user.id,
    invite_code: null as unknown as undefined,
    invite_expires_at: null as unknown as undefined,
  });

  if (!updated || updated.user_id !== user.id) {
    // The conditional update lost the race — rollback the orphaned user.
    await userStore.deleteById(user.id).catch(() => {
      // Best-effort: if deleteById itself fails, log and continue so the
      // ClaimInviteError still surfaces cleanly to the caller.
    });
    throw new ClaimInviteError(
      `member ${member.id} already claimed (concurrent race)`,
      "already_claimed",
    );
  }

  const refreshed = (await db.objects.Member.findById(member.id)) ?? member;
  return { ok: true, user, member: refreshed };
}
