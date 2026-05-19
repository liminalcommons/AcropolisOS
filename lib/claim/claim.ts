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

async function findMemberByInviteCode(
  members: ObjectAccess<Member>,
  code: string,
): Promise<Member | null> {
  // findMany is the supported steward-readable surface for invite_code in
  // the in-memory + pg implementations. Filtering by invite_code is safe
  // because we're inside an unauthenticated server action — the gate is
  // "do you possess the code itself", not "does the actor pass member_self".
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

  const member = await findMemberByInviteCode(db.objects.Member, code);
  if (!member) {
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

  const user = await userStore.create({
    email: member.email,
    password,
    role: "member",
    customRoles: [],
  });

  await db.objects.Member.update(member.id, {
    user_id: user.id,
    invite_code: null as unknown as undefined,
    invite_expires_at: null as unknown as undefined,
  });

  const refreshed = (await db.objects.Member.findById(member.id)) ?? member;
  return { ok: true, user, member: refreshed };
}
