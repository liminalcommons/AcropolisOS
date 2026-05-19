// M4.2 step-4 RED: /claim core logic. Asserted against the testable
// claimInvite() function that the page.tsx server action wraps in step 5.
//
// Choosing function-under-test over `route.test.ts` because:
//  - Next.js server actions don't have a clean test harness (the form
//    binding lives in the React tree, not as an exported handler)
//  - Existing route.test.ts patterns (api/setup/steward) work because
//    those expose POST(req); page.tsx server actions don't
//  - The substantive logic (lookup, validate expiry, create user, link
//    Member, clear invite) is what M4.2 needs proven — the form wrapping
//    is mechanical
//
// Recorded in .opponent-log-acropolisos-m4.md "Positiva findings — M4.2".

import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileUserStore } from "../auth/users";
import { createInMemoryStore, type OntologyStore } from "../ontology/ctx";
import type { Member } from "../ontology/types.generated";
import { claimInvite, ClaimInviteError } from "./claim";

const futureExpiry = (): string =>
  new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString();
const pastExpiry = (): string =>
  new Date(Date.now() - 60 * 1000).toISOString();

function memberRow(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    full_name: `Member ${id}`,
    email: `${id}@example.com`,
    joined_at: "2026-01-01",
    tier: "basic",
    notes: "",
    ...overrides,
  } as Member;
}

let dir: string;
let usersFile: string;
let userStore: FileUserStore;
let db: OntologyStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "acrop-claim-"));
  usersFile = path.join(dir, "users.json");
  userStore = new FileUserStore(usersFile);
  db = createInMemoryStore();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("claimInvite (M4.2)", () => {
  it("happy path: valid code + password creates user, links Member.user_id, clears invite fields", async () => {
    const memberId = "00000000-0000-4000-8000-000000000c01";
    const code = "abcdef0123456789abcdef0123456789";
    await db.objects.Member.create(
      memberRow(memberId, {
        email: "invitee@example.com",
        invite_code: code,
        invite_expires_at: futureExpiry(),
      } as Partial<Member>),
    );

    const result = await claimInvite({
      code,
      password: "supersecret",
      userStore,
      db,
    });

    expect(result.ok).toBe(true);
    expect(result.user.email).toBe("invitee@example.com");
    expect(result.user.role).toBe("member");

    const after = await db.objects.Member.findById(memberId);
    expect(after?.user_id).toBe(result.user.id);
    expect(after?.invite_code ?? null).toBeNull();
    expect(after?.invite_expires_at ?? null).toBeNull();

    // user is real: authorize() round-trips with the supplied password
    const authed = await userStore.authorize("invitee@example.com", "supersecret");
    expect(authed?.id).toBe(result.user.id);
  });

  it("expired code rejects with code=expired", async () => {
    const memberId = "00000000-0000-4000-8000-000000000c02";
    const code = "11111111111111112222222222222222";
    await db.objects.Member.create(
      memberRow(memberId, {
        email: "late@example.com",
        invite_code: code,
        invite_expires_at: pastExpiry(),
      } as Partial<Member>),
    );

    await expect(
      claimInvite({ code, password: "supersecret", userStore, db }),
    ).rejects.toMatchObject({
      name: "ClaimInviteError",
      code: "expired",
    });

    // No user written
    expect(await userStore.findByEmail("late@example.com")).toBeNull();
  });

  it("already-claimed code rejects with code=already_claimed", async () => {
    const memberId = "00000000-0000-4000-8000-000000000c03";
    const code = "33333333333333334444444444444444";
    await db.objects.Member.create(
      memberRow(memberId, {
        email: "twice@example.com",
        // contradictory state — invite_code lingering but user_id set —
        // is what "already claimed" guards against
        invite_code: code,
        invite_expires_at: futureExpiry(),
        user_id: "u-existing",
      } as Partial<Member>),
    );

    await expect(
      claimInvite({ code, password: "supersecret", userStore, db }),
    ).rejects.toMatchObject({
      name: "ClaimInviteError",
      code: "already_claimed",
    });
  });

  it("unknown code rejects with code=not_found", async () => {
    await expect(
      claimInvite({
        code: "deadbeefdeadbeefdeadbeefdeadbeef",
        password: "supersecret",
        userStore,
        db,
      }),
    ).rejects.toMatchObject({
      name: "ClaimInviteError",
      code: "not_found",
    });
  });

  it("ClaimInviteError exposes code for the page mapping HTTP status", () => {
    const e = new ClaimInviteError("nope", "expired");
    expect(e.code).toBe("expired");
    expect(e.name).toBe("ClaimInviteError");
    expect(e).toBeInstanceOf(Error);
  });
});
