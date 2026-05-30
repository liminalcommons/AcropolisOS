// Acceptance test: the ontology storage layer is DECONTAMINATED of the hostel
// domain. It boots a complete non-hostel ontology (book-club-org) over a
// dynamic in-memory store and proves the permission fence stays intact.
//
// HERMETIC: no codegen, no DB, no docker. createInMemoryStore(typeNames) builds
// the store from the LOADED ontology's type names; loadOntology reads YAML from
// seed/book-club-org. schema.generated.ts is never touched.
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  PermissionError,
} from "./ctx";
import { loadOntology } from "./load";
import type { Actor } from "../ctx";

const BC = path.resolve(__dirname, "..", "..", "seed", "book-club-org");

const steward: Actor = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "s@x",
  role: "steward",
  customRoles: [],
};
const member: Actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "m@x",
  role: "member",
  customRoles: [],
};

const BOOK_CLUB_TYPES = [
  "AgentBlocker",
  "Book",
  "Event",
  "MeetingMinute",
  "Member",
  "MemberContext",
  "Notification",
  "ReadingMeeting",
];
const HOSTEL_TYPES = [
  "Booking",
  "Bed",
  "Guest",
  "Room",
  "Shift",
  "WorkTradeAgreement",
  "IncidentLog",
];

describe("book-club ontology — decontaminated store, fence intact, no hostel types", () => {
  it("permissions map has exactly the book-club types, no hostel keys", async () => {
    const perms = buildObjectPermissionsMap(await loadOntology(BC));
    expect(Object.keys(perms).sort()).toEqual([...BOOK_CLUB_TYPES].sort());
    for (const h of HOSTEL_TYPES) {
      expect(perms[h], `${h} must be absent`).toBeUndefined();
    }
  });

  it("in-memory store is built dynamically over the loaded ontology (book types, not hostel)", async () => {
    const o = await loadOntology(BC);
    const keys = Object.keys(
      createInMemoryStore(Object.keys(o.object_types)).objects,
    );
    expect(keys).toContain("Book");
    expect(keys).toContain("ReadingMeeting");
    expect(keys).not.toContain("Bed");
    expect(keys).not.toContain("Guest");
  });

  it("Book (read:[*], write:[steward]): steward writes; member reads but write fail-closes", async () => {
    const o = await loadOntology(BC);
    const db = createInMemoryStore(Object.keys(o.object_types));
    const perms = buildObjectPermissionsMap(o);
    // Confirm the perms we are exercising are the ones the YAML declares.
    expect(perms.Book.read).toEqual(["*"]);
    expect(perms.Book.write).toEqual(["steward"]);

    const BOOK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.objects.Book.create({
      id: BOOK,
      title: "Dune",
      author: "Herbert",
      year: 1965,
    } as never);

    const s = createCtx({ db, actor: steward, permissions: perms });
    expect(await s.objects.Book.findById(BOOK)).not.toBeNull();
    expect(
      await s.objects.Book.update(BOOK, { title: "Dune (rev)" } as never),
    ).not.toBeNull();

    const m = createCtx({ db, actor: member, permissions: perms });
    // read:[*] — any member can read.
    expect(await m.objects.Book.findById(BOOK)).not.toBeNull();
    // write:[steward] — a plain member is denied.
    await expect(
      m.objects.Book.update(BOOK, { title: "x" } as never),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("AgentBlocker (read:[steward,member_self]): non-owner member read fail-closes to null, write throws", async () => {
    const o = await loadOntology(BC);
    const db = createInMemoryStore(Object.keys(o.object_types));
    const perms = buildObjectPermissionsMap(o);
    // Read is steward-gated (member_self only, NOT "*"): a member who does not
    // own the row cannot read it. This is the fail-closed contract.
    expect(perms.AgentBlocker.read).not.toContain("*");
    expect(perms.AgentBlocker.read).toEqual(["steward", "member_self"]);

    const AB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    // blocked_actor_id is left UNSET, so the `member` actor does not own this
    // row — member_self cannot match and the read must fail closed to null.
    await db.objects.AgentBlocker.create({
      id: AB,
      summary: "x",
      reason_kind: "approval",
      status: "open",
    } as never);

    const m = createCtx({ db, actor: member, permissions: perms });
    expect(await m.objects.AgentBlocker.findById(AB)).toBeNull();
    await expect(
      m.objects.AgentBlocker.update(AB, { status: "resolved" } as never),
    ).rejects.toBeInstanceOf(PermissionError);

    // Sanity: a steward CAN read and write the same row (fence is not a blanket deny).
    const s = createCtx({ db, actor: steward, permissions: perms });
    expect(await s.objects.AgentBlocker.findById(AB)).not.toBeNull();
    expect(
      await s.objects.AgentBlocker.update(AB, { status: "resolved" } as never),
    ).not.toBeNull();
  });
});
