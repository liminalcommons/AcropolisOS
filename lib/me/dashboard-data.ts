// Dashboard data fetcher for the manager home route (F5).
//
// Uses getDb() directly for hostel-domain tables (Booking, Bed, Room, Guest,
// Shift, WorkTradeAgreement) because those types are not yet surfaced through
// ctx.objects.* (only Member / Event / MemberContext / AgentBlocker are wired
// in pg-store.ts). The OntologyCtx parameter is accepted for Member access and
// future alignment when hostel types migrate into ctx.objects.
//
// IMPORTANT: this file is the ONLY place that opens a DB connection for the
// dashboard. app/page.tsx must pass ctx here and not call buildChatRuntime()
// again in child components.

import { getDb } from "@/lib/db/client";
import {
  booking as bookingTable,
  bed as bedTable,
  room as roomTable,
  guest as guestTable,
  shift as shiftTable,
  work_trade_agreement as wtaTable,
  member as memberTable,
} from "@/lib/db/schema.generated";
import type {
  Booking,
  Bed,
  Room,
  Guest,
  Shift,
  WorkTradeAgreement,
  Member,
} from "@/lib/ontology/types.generated";

export interface DashboardRaw {
  bookings: Booking[];
  beds: Bed[];
  rooms: Room[];
  guests: Guest[];
  shifts: Shift[];
  members: Member[];
  workTrades: WorkTradeAgreement[];
}

/**
 * Fetches all hostel-domain rows needed for the manager dashboard in one
 * parallel sweep. Returns raw arrays; derivation lives in dashboard-derive.ts.
 *
 * Drizzle returns date columns as ISO strings ("2026-06-05") and timestamptz
 * columns as Date objects — callers must handle both shapes.
 */
export async function fetchDashboardData(): Promise<DashboardRaw> {
  const db = getDb();

  // Parallel sweep — all tables independent.
  // Note: Drizzle's PgSelectBase is PromiseLike but not Promise; cast via unknown.
  const [bookings, beds, rooms, guests, shifts, members, workTrades] =
    await Promise.all([
      db.select().from(bookingTable) as unknown as Promise<Booking[]>,
      db.select().from(bedTable) as unknown as Promise<Bed[]>,
      db.select().from(roomTable) as unknown as Promise<Room[]>,
      db.select().from(guestTable) as unknown as Promise<Guest[]>,
      db.select().from(shiftTable) as unknown as Promise<Shift[]>,
      db.select().from(memberTable) as unknown as Promise<Member[]>,
      db.select().from(wtaTable) as unknown as Promise<WorkTradeAgreement[]>,
    ]);

  return { bookings, beds, rooms, guests, shifts, members, workTrades };
}
