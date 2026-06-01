// M2.2 step-2 + M5 registry expansion: PgOntologyStore unit test.
//
// Verifies that `createPgOntologyStore(db)` returns an OntologyStore whose
// Member/Event/MeetingMinute object-accessors invoke the expected drizzle
// operations against the right tables. The test stubs the drizzle Database
// surface so it runs hermetically — full SQL semantics are covered by the
// existing audit-store + drizzle integration tests.
//
// M5 additions: asserts all 13 ontology object types are present on the store
// and that newly-exposed hostel-domain types (e.g. Booking) target the
// correct drizzle table. Permission enforcement for the new types is proven in
// pg-store-permission.test.ts (same wrapObjectAccess path as the original 4).
//
// Why this layer: change-tier.ts:27 calls `ctx.objects.Member.update(...)`
// which currently throws in production because no Pg-backed implementation
// of the OntologyStore interface (declared at lib/ontology/ctx.ts:47-56)
// exists. This module is that implementation.

import { describe, expect, it } from "vitest";
import {
  member as memberTable,
  event as eventTable,
  booking as bookingTable,
  bed as bedTable,
  guest as guestTable,
  incident_log as incidentLogTable,
  meeting_minute as meetingMinuteTable,
  notification as notificationTable,
  room as roomTable,
  shift as shiftTable,
  work_trade_agreement as workTradeAgreementTable,
} from "../db/schema.generated";
import { createPgOntologyStore } from "./pg-store";
import { buildStubDb } from "./__test-helpers/stub-db";

describe("createPgOntologyStore — M2.2 step 2", () => {
  it("exposes Member/Event accessors", () => {
    const { db } = buildStubDb();
    const store = createPgOntologyStore(db);
    expect(store.objects.Member).toBeDefined();
    expect(store.objects.Event).toBeDefined();
    expect(typeof store.objects.Member.findById).toBe("function");
    expect(typeof store.objects.Member.update).toBe("function");
  });

  it("Member.update issues drizzle update against `member` table and returns first row", async () => {
    const memberRow = {
      id: "abc-id",
      full_name: "Alice",
      email: "a@x.test",
      phone: "555-0000",
      tier_role: "work_trader",
      started_at: "2024-01-01",
      notes: "",
    };
    const { db, capture } = buildStubDb({ returningRows: [memberRow] });
    const store = createPgOntologyStore(db);

    const updated = await store.objects.Member.update("abc-id", {
      tier_role: "work_trader",
    });

    expect(capture.table).toBe(memberTable);
    expect(capture.setValues).toEqual({ tier_role: "work_trader" });
    expect(capture.whereCond).toBeDefined();
    expect(updated).toEqual(memberRow);
  });

  it("Member.update returns null when no row was updated", async () => {
    const { db } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    const out = await store.objects.Member.update("missing-id", {
      tier_role: "staff",
    });
    expect(out).toBeNull();
  });

  it("Member.findById issues select against `member` and returns first row or null", async () => {
    const row = {
      id: "id-1",
      full_name: "Bob",
      email: "b@x.test",
      phone: "555-0001",
      tier_role: "staff",
      started_at: "2024-02-01",
      notes: "",
    };
    {
      const { db, capture } = buildStubDb({ selectRows: [row] });
      const store = createPgOntologyStore(db);
      const out = await store.objects.Member.findById("id-1");
      expect(capture.table).toBe(memberTable);
      expect(out).toEqual(row);
    }
    {
      const { db } = buildStubDb({ selectRows: [] });
      const store = createPgOntologyStore(db);
      const out = await store.objects.Member.findById("nope");
      expect(out).toBeNull();
    }
  });

  it("Member.create inserts into `member` and returns the inserted row", async () => {
    const row = {
      id: "x-1",
      full_name: "Carol",
      email: "c@x.test",
      phone: "555-0002",
      tier_role: "staff" as const,
      started_at: "2024-03-01",
      notes: "",
    };
    const { db, capture } = buildStubDb({ returningRows: [row] });
    const store = createPgOntologyStore(db);
    const out = await store.objects.Member.create(row);
    expect(capture.table).toBe(memberTable);
    expect(capture.inserted).toEqual(row);
    expect(out).toEqual(row);
  });

  it("Event accessor targets the `event` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.Event.update("e-1", { title: "x" });
    expect(capture.table).toBe(eventTable);
  });

});

// === M5: all-13-types registry expansion ===

describe("createPgOntologyStore — M5 registry expansion", () => {
  const ALL_OBJECT_TYPES = [
    "AgentBlocker",
    "Bed",
    "Booking",
    "Event",
    "Guest",
    "IncidentLog",
    "MeetingMinute",
    "Member",
    "MemberContext",
    "Notification",
    "Room",
    "Shift",
    "WorkTradeAgreement",
  ] as const;

  it("exposes all 13 object types on ctx.objects", () => {
    const { db } = buildStubDb();
    const store = createPgOntologyStore(db);
    for (const typeName of ALL_OBJECT_TYPES) {
      const access = store.objects[typeName];
      expect(access, `${typeName} should be defined on store.objects`).toBeDefined();
      expect(typeof access.findById, `${typeName}.findById`).toBe("function");
      expect(typeof access.findMany, `${typeName}.findMany`).toBe("function");
      expect(typeof access.create, `${typeName}.create`).toBe("function");
      expect(typeof access.update, `${typeName}.update`).toBe("function");
      expect(typeof access.delete, `${typeName}.delete`).toBe("function");
    }
  });

  it("Booking accessor targets the `booking` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.Booking.update("b-1", { status: "confirmed" });
    expect(capture.table).toBe(bookingTable);
  });

  it("Bed accessor targets the `bed` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.Bed.update("b-1", { out_of_service: true });
    expect(capture.table).toBe(bedTable);
  });

  it("Guest accessor targets the `guest` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.Guest.update("g-1", { current_status: "checked_in" });
    expect(capture.table).toBe(guestTable);
  });

  it("IncidentLog accessor targets the `incident_log` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.IncidentLog.update("i-1", { resolved: true });
    expect(capture.table).toBe(incidentLogTable);
  });

  it("MeetingMinute accessor targets the `meeting_minute` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.MeetingMinute.update("m-1", { title: "x" });
    expect(capture.table).toBe(meetingMinuteTable);
  });

  it("Notification accessor targets the `notification` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.Notification.update("n-1", { kind: "info" });
    expect(capture.table).toBe(notificationTable);
  });

  it("Room accessor targets the `room` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.Room.update("r-1", { capacity: 4 });
    expect(capture.table).toBe(roomTable);
  });

  it("Shift accessor targets the `shift` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.Shift.update("s-1", { status: "done" });
    expect(capture.table).toBe(shiftTable);
  });

  it("WorkTradeAgreement accessor targets the `work_trade_agreement` table", async () => {
    const { db, capture } = buildStubDb({ returningRows: [] });
    const store = createPgOntologyStore(db);
    await store.objects.WorkTradeAgreement.update("w-1", { status: "active" });
    expect(capture.table).toBe(workTradeAgreementTable);
  });
});
