// check_in function-backed handler — TDD coverage.
//
// Mirrors promote-to-steward.test.ts: loads the REAL active ontology (which
// carries the hostel Booking/Guest types + the check_in action wired to
// functions/check-in.ts) and invokes through invokeAction — the same code path
// the apply_action dispatcher uses after a human confirms (bypassConfirmation).
//
// Proves the always_confirm governance handler body:
//   - a confirmed booking → Booking.status becomes "checked_in"
//   - the booking's Guest.current_status becomes "checked_in"
//   - permission ([steward, manager]) is inherited from the dispatcher: a
//     member-actor invocation is denied and mutates nothing.

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/ctx";
import { invokeAction } from "@/lib/actions/invoke";
import { loadOntology } from "@/lib/ontology/load";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "@/lib/ontology/ctx";
import { InMemoryAuditStore } from "@/lib/audit/writer";
import type { Booking, Guest } from "@/lib/ontology/types.generated";
import type { Ontology } from "@/lib/ontology/schema";

// The active ontology (top-level ontology/) carries the hostel domain: Booking,
// Guest, IncidentLog, plus the check_in / log_incident actions.
const ONTOLOGY_ROOT = path.resolve(__dirname, "..", "ontology");
const FUNCTIONS_DIR = path.resolve(__dirname, ".");

const steward: Actor = {
  userId: "00000000-0000-4000-8000-0000000000cc",
  email: "stew@example.com",
  role: "steward",
  customRoles: [],
};

const member: Actor = {
  userId: "00000000-0000-4000-8000-0000000000aa",
  email: "ada@example.com",
  role: "member",
  customRoles: [],
};

const GUEST_ID = "00000000-0000-4000-8001-000000000010";
const BOOKING_ID = "00000000-0000-4000-8002-000000000010";

function guestRow(overrides: Partial<Guest> = {}): Guest {
  return {
    id: GUEST_ID,
    full_name: "Lena Petrov",
    email: "lena@example.com",
    country: "BR",
    phone: "555-0000",
    arrived_at: "2026-06-03",
    expected_departure: "2026-06-07",
    current_status: "booked",
    is_work_trader: false,
    ...overrides,
  };
}

function bookingRow(overrides: Partial<Booking> = {}): Booking {
  return {
    id: BOOKING_ID,
    label: "Lena Petrov / D3-A2 / Jun 3-7",
    guest: GUEST_ID,
    bed: "00000000-0000-4000-8003-000000000010",
    from_date: "2026-06-03",
    to_date: "2026-06-07",
    rate_per_night: 0,
    currency: "EUR",
    source: "direct",
    status: "confirmed",
    ...overrides,
  };
}

let ontology: Ontology;
let db: OntologyStore;
let audit: InMemoryAuditStore;
let stewardCtx: OntologyCtx;
let memberCtx: OntologyCtx;

beforeEach(async () => {
  ontology = await loadOntology(ONTOLOGY_ROOT);
  const permissions = buildObjectPermissionsMap(ontology);
  db = createInMemoryStore();
  audit = new InMemoryAuditStore();
  stewardCtx = createCtx({ db, actor: steward, permissions, audit });
  memberCtx = createCtx({ db, actor: member, permissions, audit });
});

describe("check_in — active ontology wiring", () => {
  it("the yaml + function file discover one another (function: check-in, always_confirm)", () => {
    const def = ontology.action_types.check_in;
    expect(def).toBeDefined();
    expect(def?.function).toBe("check-in");
    expect(def?.agent_policy).toBe("always_confirm");
    expect(def?.permissions).toEqual(["steward", "manager"]);
  });
});

describe("check_in — handler effect", () => {
  it("checks the booking in and mirrors the guest's current_status", async () => {
    await db.objects.Guest.create(guestRow());
    await db.objects.Booking.create(bookingRow({ status: "confirmed" }));

    const result = await invokeAction({
      actionName: "check_in",
      params: { booking: BOOKING_ID },
      ctx: stewardCtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
    });

    expect(result).toMatchObject({
      ok: true,
      booking: BOOKING_ID,
      booking_status: "checked_in",
      guest: GUEST_ID,
      guest_status: "checked_in",
      checked_in: true,
    });

    const booking = await db.objects.Booking.findById(BOOKING_ID);
    expect(booking?.status).toBe("checked_in");

    const guest = await db.objects.Guest.findById(GUEST_ID);
    expect(guest?.current_status).toBe("checked_in");
  });

  it("is idempotent-ish: a second check_in on an already-checked-in booking still succeeds", async () => {
    await db.objects.Guest.create(guestRow({ current_status: "checked_in" }));
    await db.objects.Booking.create(bookingRow({ status: "checked_in" }));

    const result = await invokeAction({
      actionName: "check_in",
      params: { booking: BOOKING_ID },
      ctx: stewardCtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
    });

    expect(result).toMatchObject({ ok: true, booking_status: "checked_in" });
    const booking = await db.objects.Booking.findById(BOOKING_ID);
    expect(booking?.status).toBe("checked_in");
  });

  it("returns booking_not_found for an unknown booking id", async () => {
    const result = await invokeAction({
      actionName: "check_in",
      params: { booking: "00000000-0000-4000-8002-0000000000ff" },
      ctx: stewardCtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
    });
    expect(result).toMatchObject({ ok: false, reason: "booking_not_found" });
  });

  it("DENIES a member-actor invocation (permission inherited from dispatcher) and mutates nothing", async () => {
    await db.objects.Guest.create(guestRow());
    await db.objects.Booking.create(bookingRow({ status: "confirmed" }));

    await expect(
      invokeAction({
        actionName: "check_in",
        params: { booking: BOOKING_ID },
        ctx: memberCtx,
        ontology,
        functionsDir: FUNCTIONS_DIR,
      }),
    ).rejects.toThrow(/cannot invoke action "check_in"/);

    const booking = await db.objects.Booking.findById(BOOKING_ID);
    expect(booking?.status).toBe("confirmed");
    const guest = await db.objects.Guest.findById(GUEST_ID);
    expect(guest?.current_status).toBe("booked");
  });
});
