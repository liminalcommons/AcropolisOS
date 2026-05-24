// F5 — Hostal Solana manager dashboard.
//
// Server component. Auth guard: middleware (lib/middleware/route-decision.ts)
// intercepts unauthenticated callers before the page renders.
//
// PERF: buildChatRuntime() is called ONCE per request; the resulting
// chatRuntime.ctx is forwarded to all child fetchers. Child fetchers MUST NOT
// re-call buildChatRuntime() — that would rebuild the ontology + auth on every
// fetch.
//
// Hostel tables (Booking, Bed, Room, Shift, WorkTradeAgreement, Guest) are not
// exposed via ctx.objects (that surface covers only community ontology types).
// They are queried here via getDb() + drizzle tables from schema.generated.

import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gte, lte, lt, inArray } from "drizzle-orm";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import {
  booking as bookingTable,
  bed as bedTable,
  room as roomTable,
  shift as shiftTable,
  work_trade_agreement as wtaTable,
  guest as guestTable,
} from "@/lib/db/schema.generated";
import { TODAY, TODAY_LABEL, serverNow } from "@/lib/me/today";
import { getOrCreateMemberContext } from "@/lib/me/fetchers/member-context";
import { PinnedWidget, type PinnedWidgetShape } from "@/components/dashboard/PinnedWidget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Types ──────────────────────────────────────────────────────────────────

type BedRow = typeof bedTable.$inferSelect;
type RoomRow = typeof roomTable.$inferSelect;
type BookingRow = typeof bookingTable.$inferSelect;
type GuestRow = typeof guestTable.$inferSelect;
type ShiftRow = typeof shiftTable.$inferSelect;
type WtaRow = typeof wtaTable.$inferSelect;

interface BedWithRoom extends BedRow {
  roomRow: RoomRow;
}

type BedState = "occupied" | "no_show" | "available" | "out_of_service";

interface BedCell {
  bed: BedWithRoom;
  state: BedState;
  booking: BookingRow | null;
  guest: GuestRow | null;
}

interface RoomGroup {
  room: RoomRow;
  cells: BedCell[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// TODAY as a plain ISO date string for SQL date comparisons.
const TODAY_ISO = TODAY.toISOString().slice(0, 10); // "2026-06-05"

// tomorrow ISO for "starts_at < tomorrow" boundary in shift query
const TOMORROW_ISO = new Date(TODAY.getTime() + 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

// Format a date string or Date to "Jun 5" style
function fmtDateShort(d: string | Date): string {
  const dt = typeof d === "string" ? new Date(d + "T00:00:00Z") : d;
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Extract short label from a bed code: "D2-C2" → "C2"
function bedShortLabel(code: string): string {
  const parts = code.split("-");
  // "D2-C2" → ["D2","C2"] → "C2"
  // "P1-double" → "dbl"
  // "P2-1" → "P2-1" (keep as-is for private rooms)
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    // If last part is "double" shorten it
    if (last === "double") return "dbl";
    return last;
  }
  return code;
}

// ─── Reversibility dot component ─────────────────────────────────────────────

function ReversibilityDots({ color }: { color: "amber" | "green" | "red" }) {
  const dotColors = {
    amber: ["bg-emerald-500", "bg-amber-500", "bg-zinc-700"],
    green: ["bg-emerald-500", "bg-zinc-700", "bg-zinc-700"],
    red: ["bg-red-500", "bg-red-500", "bg-red-500"],
  };
  const colors = dotColors[color];
  return (
    <div className="flex gap-1 items-center" title="Reversibility / cost">
      {colors.map((c, i) => (
        <span key={i} className={`w-2 h-2 rounded-full ${c}`} />
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function Home(): Promise<React.ReactElement> {
  // Auth guard — middleware enforces this; defense-in-depth for direct calls.
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    redirect("/signin");
  }

  // Fetch pinned widgets for this actor. Resolve Member row first (MemberContext
  // links to Member.id, not to auth userId directly in all cases).
  let pinnedWidgets: PinnedWidgetShape[] = [];
  try {
    const members = await chatRuntime.ctx.objects.Member.findMany();
    const me = members.find((m) => m.id === chatRuntime.actor!.userId);
    if (me) {
      const mc = await getOrCreateMemberContext(chatRuntime.ctx, me.id);
      const raw = mc.pinned_widgets;
      let parsed: unknown[] | null = null;
      if (Array.isArray(raw)) {
        parsed = raw;
      } else if (typeof raw === "string") {
        try {
          const p = JSON.parse(raw);
          if (Array.isArray(p)) parsed = p;
        } catch { /* ignore */ }
      }
      if (parsed) {
        pinnedWidgets = parsed as PinnedWidgetShape[];
      }
    }
  } catch {
    // Non-fatal — dashboard renders without pinned widgets if context unavailable.
  }

  const db = getDb();
  const now = serverNow();

  // ── Card A: Daniyar no-show (bk-010) ──────────────────────────────────────
  const [daniyarBooking] = await db
    .select()
    .from(bookingTable)
    .where(and(eq(bookingTable.status, "no_show"), eq(bookingTable.from_date, TODAY_ISO)))
    .limit(1);

  let daniyarGuest: GuestRow | null = null;
  let daniyarBed: BedRow | null = null;
  if (daniyarBooking) {
    const [g] = await db
      .select()
      .from(guestTable)
      .where(eq(guestTable.id, daniyarBooking.guest))
      .limit(1);
    daniyarGuest = g ?? null;

    const [b] = await db
      .select()
      .from(bedTable)
      .where(eq(bedTable.id, daniyarBooking.bed))
      .limit(1);
    daniyarBed = b ?? null;
  }

  // Compute hours late from expected check-in 16:00 UTC
  const expectedCheckin = new Date("2026-06-05T16:00:00Z");
  const hoursLateRaw = (now.getTime() - expectedCheckin.getTime()) / 3.6e6;
  const hoursLate = hoursLateRaw > 0 ? Math.floor(hoursLateRaw) : null;

  // ── Card B: Open shift within 24h ─────────────────────────────────────────
  // starts_at >= TODAY (00:00Z) AND starts_at < TOMORROW (00:00Z) AND status='open'
  const openShifts = await db
    .select()
    .from(shiftTable)
    .where(
      and(
        eq(shiftTable.status, "open"),
        gte(shiftTable.starts_at, new Date(TODAY_ISO + "T00:00:00Z")),
        lt(shiftTable.starts_at, new Date(TOMORROW_ISO + "T00:00:00Z")),
      ),
    );

  // Sort by starts_at ascending; take first
  openShifts.sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
  const openShift: ShiftRow | null = openShifts[0] ?? null;

  // ── Card C: Sofía's work-trade agreement ──────────────────────────────────
  // Find Sofía's guest row (g-011), then find active WTA for that guest.
  // The seed uses natural IDs (g-011, hm-005) but DB uses UUIDs — query by email.
  const [sofiaGuest] = await db
    .select()
    .from(guestTable)
    .where(eq(guestTable.email, "sofia.m@example.org"))
    .limit(1);

  let sofiaWta: WtaRow | null = null;
  if (sofiaGuest) {
    const [wta] = await db
      .select()
      .from(wtaTable)
      .where(
        and(eq(wtaTable.guest, sofiaGuest.id), eq(wtaTable.status, "active")),
      )
      .limit(1);
    sofiaWta = wta ?? null;
  }

  // ── Bed grid ──────────────────────────────────────────────────────────────
  const allBeds = await db.select().from(bedTable);
  const allRooms = await db.select().from(roomTable);

  // Non-staff rooms for the guest-facing grid
  const guestRooms = allRooms.filter((r) => r.kind !== "staff");
  const guestRoomIds = new Set(guestRooms.map((r) => r.id));
  const guestBeds = allBeds.filter((b) => guestRoomIds.has(b.room));

  // All bookings covering TODAY for the guest beds
  // from_date <= TODAY AND to_date > TODAY (departure is exclusive)
  const bedIds = guestBeds.map((b) => b.id);
  let todayBookings: BookingRow[] = [];
  if (bedIds.length > 0) {
    todayBookings = await db
      .select()
      .from(bookingTable)
      .where(
        and(
          inArray(bookingTable.bed, bedIds),
          lte(bookingTable.from_date, TODAY_ISO),
          gte(bookingTable.to_date, TODAY_ISO), // to_date > today means to_date >= today (inclusive departure night)
          inArray(bookingTable.status, ["confirmed", "checked_in", "no_show"]),
        ),
      );
  }

  // Fetch guests for occupied/no_show bookings
  const occupiedGuestIds = [
    ...new Set(todayBookings.map((b) => b.guest).filter(Boolean)),
  ];
  let occupiedGuests: GuestRow[] = [];
  if (occupiedGuestIds.length > 0) {
    occupiedGuests = await db
      .select()
      .from(guestTable)
      .where(inArray(guestTable.id, occupiedGuestIds));
  }
  const guestById = new Map<string, GuestRow>(
    occupiedGuests.map((g) => [g.id, g]),
  );
  const bookingByBedId = new Map<string, BookingRow>(
    todayBookings.map((b) => [b.bed, b]),
  );

  // Build bed cells
  const roomById = new Map<string, RoomRow>(allRooms.map((r) => [r.id, r]));

  function computeBedState(bed: BedRow, bk: BookingRow | null): BedState {
    if (bed.out_of_service) return "out_of_service";
    if (!bk) return "available";
    if (bk.status === "no_show") return "no_show";
    return "occupied";
  }

  // Build room groups (non-staff only, sorted by room code)
  const roomGroups: RoomGroup[] = guestRooms
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((room) => {
      const roomBeds = guestBeds
        .filter((b) => b.room === room.id)
        .sort((a, b) => a.code.localeCompare(b.code));

      const cells: BedCell[] = roomBeds.map((bed) => {
        const bk = bookingByBedId.get(bed.id) ?? null;
        const g = bk ? (guestById.get(bk.guest) ?? null) : null;
        return {
          bed: { ...bed, roomRow: room },
          state: computeBedState(bed, bk),
          booking: bk,
          guest: g,
        };
      });

      return { room, cells };
    });

  // Counts
  const visibleBeds = guestBeds.filter((b) => !b.out_of_service);
  const visibleCount = visibleBeds.length;
  const oosCount = guestBeds.filter((b) => b.out_of_service).length;

  const occupiedCount = todayBookings.filter(
    (b) => b.status === "checked_in" || b.status === "confirmed",
  ).length;
  const noShowCount = todayBookings.filter((b) => b.status === "no_show").length;

  // ─── JSX ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            Hostal Solana{" "}
            <span className="text-zinc-500 font-normal">·</span>{" "}
            <span className="text-zinc-400 font-normal">today</span>
          </h1>
          <p className="mt-1 text-xs text-zinc-500">{TODAY_LABEL}</p>
        </div>

        {/* ── Section 1: Attention cards ── */}
        <section className="space-y-3">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">
            Needs your attention
          </p>

          {/* Card A — Daniyar no-show */}
          {daniyarBooking && (
            <Link
              href={`/scenario/no-show/${daniyarBooking.id}`}
              className="block rounded-lg border border-amber-700/40 bg-amber-950/20 p-4 hover:border-amber-600/60 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 text-sm">⚠</span>
                    <p className="text-sm font-semibold text-amber-300">
                      {daniyarGuest?.full_name ?? "Guest"} didn&apos;t check in
                    </p>
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-400">
                    Booked bed{" "}
                    <span className="font-mono text-zinc-200">
                      {daniyarBed?.code ?? "—"}
                    </span>{" "}
                    {fmtDateShort(daniyarBooking.from_date)} →{" "}
                    {fmtDateShort(daniyarBooking.to_date)}
                    {hoursLate !== null
                      ? ` · ${hoursLate}h past expected check-in`
                      : " · expected check-in: 4pm"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <ReversibilityDots color="amber" />
                  <span className="text-xs text-amber-600">Open →</span>
                </div>
              </div>
            </Link>
          )}

          {/* Card B — Open shift needing cover */}
          {openShift && (
            <div className="rounded-lg border border-violet-700/30 bg-violet-950/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-violet-300">
                    Open shift — {openShift.kind}{" "}
                    <span className="font-normal text-violet-400/70">
                      (
                      {new Date(openShift.starts_at).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "UTC",
                        hour12: false,
                      })}
                      –
                      {new Date(
                        new Date(openShift.starts_at).getTime() +
                          Number(openShift.duration_hours) * 3.6e6,
                      ).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "UTC",
                        hour12: false,
                      })}
                      )
                    </span>
                  </p>
                  <p className="mt-1.5 text-xs text-zinc-400">
                    {openShift.notes
                      ? openShift.notes
                      : "Unstaffed — needs someone to claim it."}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <ReversibilityDots color="green" />
                  <span className="text-xs text-violet-600">Review →</span>
                </div>
              </div>
            </div>
          )}

          {/* Card C — Sofía's work-trade */}
          {sofiaWta && (
            <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/30 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-200">
                    Sofía&apos;s work-trade
                  </p>
                  <p className="mt-1.5 text-xs text-zinc-400">
                    {sofiaWta.hours_per_week}h/week · Agreement active since{" "}
                    {fmtDateShort(sofiaWta.start_date)} through{" "}
                    {fmtDateShort(sofiaWta.end_date)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <ReversibilityDots color="green" />
                  <span className="text-xs text-zinc-500">See agreement →</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Section 2: Bed grid ── */}
        <section className="space-y-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-5">
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-sm font-semibold text-zinc-200">
                Tonight&apos;s beds — {TODAY_LABEL}
              </p>
            </div>
            <p className="text-[11px] text-zinc-500 mb-5">
              Hover any bed to see who&apos;s in it.
            </p>

            <div className="space-y-5">
              {roomGroups.map(({ room, cells }) => (
                <div key={room.id}>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">
                    {room.code} · {room.kind} ·{" "}
                    {cells.filter((c) => !c.bed.out_of_service).length} visible
                  </p>
                  <div className="flex gap-1.5 flex-wrap">
                    {cells.map(({ bed, state, booking, guest }) => {
                      const shortLabel = bedShortLabel(bed.code);
                      let title = bed.code;
                      if (state === "occupied" && guest && booking) {
                        title = `${guest.full_name} · ${fmtDateShort(booking.from_date)} → ${fmtDateShort(booking.to_date)}`;
                      } else if (state === "no_show" && guest && booking) {
                        title = `NO-SHOW: ${guest.full_name} · expected ${fmtDateShort(booking.from_date)}`;
                      } else if (state === "out_of_service") {
                        title = `OOS: ${bed.notes ?? bed.code}`;
                      }

                      let cellClass =
                        "w-9 h-9 rounded flex items-center justify-center text-[9px] font-semibold cursor-default select-none relative";

                      if (state === "occupied") {
                        cellClass +=
                          " border border-emerald-700 bg-emerald-950 text-emerald-300";
                      } else if (state === "no_show") {
                        cellClass +=
                          " border border-amber-500 bg-amber-950/40 text-amber-300 animate-pulse";
                      } else if (state === "out_of_service") {
                        cellClass +=
                          " border border-zinc-700 text-zinc-600";
                        // OOS uses inline background — handled below
                      } else {
                        // available
                        cellClass += " border border-zinc-800 bg-zinc-900 text-zinc-600";
                      }

                      const cellContent =
                        state === "occupied" && guest
                          ? guest.full_name[0].toUpperCase()
                          : state === "no_show"
                            ? "⚠"
                            : shortLabel;

                      if (state === "out_of_service") {
                        return (
                          <div
                            key={bed.id}
                            title={title}
                            className={cellClass}
                            style={{
                              backgroundImage:
                                "repeating-linear-gradient(45deg, #27272a 0, #27272a 1px, transparent 0, transparent 50%)",
                              backgroundSize: "6px 6px",
                              backgroundColor: "#09090b",
                            }}
                          >
                            <span className="text-zinc-600 text-[9px]">
                              {shortLabel}
                            </span>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={bed.id}
                          title={title}
                          className={cellClass}
                        >
                          {cellContent}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Legend row */}
            <div className="mt-5 pt-4 border-t border-zinc-800 text-[10px] text-zinc-500">
              {occupiedCount}/{visibleCount} occupied · {noShowCount} no-show ·{" "}
              {oosCount} OOS
            </div>
          </div>
        </section>

        {/* ── Pinned widgets (F6) ── */}
        {pinnedWidgets.length > 0 && (
          <section className="space-y-4">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">
              Your widgets
            </p>
            {pinnedWidgets.map((w) => (
              <PinnedWidget key={w.id} widget={w} />
            ))}
          </section>
        )}

        {/* ── Ask agent affordance (F6: real link) ── */}
        <section>
          <Link
            href="/dashboard/ask"
            className="block rounded-lg border border-dashed border-zinc-700 p-4 hover:border-zinc-500 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="text-zinc-600 text-sm mt-0.5">⌗</span>
              <div>
                <p className="text-sm font-medium text-zinc-500">
                  + Ask the agent to add a widget
                </p>
                <p className="text-[11px] text-zinc-600 mt-0.5 italic">
                  e.g. &quot;show me tonight&apos;s check-ins&quot; or &quot;pin kitchen stock levels&quot;
                </p>
              </div>
            </div>
          </Link>
        </section>

        {/* ── F4: Raw inbox / organize link ── */}
        <section>
          <Link
            href="/organize"
            className="block rounded-lg border border-dashed border-zinc-700/60 p-4 hover:border-zinc-500 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="text-zinc-600 text-sm mt-0.5">⊞</span>
              <div>
                <p className="text-sm font-medium text-zinc-500">
                  Organize raw inbox
                </p>
                <p className="text-[11px] text-zinc-600 mt-0.5 italic">
                  Let the agent classify inbound messy data into typed objects
                </p>
              </div>
            </div>
          </Link>
        </section>

      </div>
    </main>
  );
}
