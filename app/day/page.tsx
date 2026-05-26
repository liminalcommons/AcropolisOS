// Day view — steward-facing "Today" page.
//
// Shows the operational script for a chosen date: arrivals, departures,
// no-shows, in-house occupancy, shifts, incidents, and work-traders.
// READ-ONLY. No server actions or mutations.
//
// Hostel domain tables (booking, bed, guest, shift, incident_log) are not yet
// wired into ctx.objects (only Member/Event/MemberContext/AgentBlocker are).
// We query them directly via getDb() + drizzle tables from schema.generated.ts.
// Auth gate still uses buildChatRuntime() + isAnonymous() per the standard
// pattern from /me.

import Link from "next/link";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import {
  booking as bookingTable,
  bed as bedTable,
  guest as guestTable,
  shift as shiftTable,
  incident_log as incidentLogTable,
} from "@/lib/db/schema.generated";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Date helpers ──────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

/** Add `delta` days to a YYYY-MM-DD string, returning a new YYYY-MM-DD string.
 *  Handles month/year boundaries correctly via Date arithmetic. */
function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr + "T12:00:00Z"); // noon UTC avoids DST edge cases
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Extract the YYYY-MM-DD portion from a Date object (from drizzle timestamp col).
 *  NOTE: timestamps are bucketed by their UTC date. For a single-locale hostel this
 *  is fine; if the hostel's local timezone is far from UTC, late-night events could
 *  bucket to an adjacent day. Revisit with a hostel-timezone setting if it matters. */
function dateOf(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// ── Severity badge colour ─────────────────────────────────────────────────────

const SEVERITY_CLASSES: Record<string, string> = {
  critical: "bg-destructive/20 text-destructive border-destructive/40",
  high:     "bg-destructive/10 text-destructive border-destructive/30",
  medium:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low:      "bg-muted text-muted-foreground border-border",
  info:     "bg-muted text-muted-foreground border-border",
};

function severityClass(s: string): string {
  return SEVERITY_CLASSES[s] ?? SEVERITY_CLASSES.info;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default async function DayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  // Auth gate — same pattern as /me
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    return (
      <main className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-muted-foreground">
          Sign in to view the day script.{" "}
          <Link href="/signin" className="underline text-foreground">
            Sign in
          </Link>
        </p>
      </main>
    );
  }

  // Resolve date from searchParams (default 2026-06-05)
  const DEFAULT_DATE = "2026-06-05";
  const params = await searchParams;
  const rawDate = typeof params.date === "string" ? params.date : DEFAULT_DATE;
  const D = isValidDate(rawDate) ? rawDate : DEFAULT_DATE;

  const prevDay = addDays(D, -1);
  const nextDay = addDays(D, 1);

  // ── Query hostel domain tables directly via drizzle ───────────────────────
  const db = getDb();

  const [bookings, beds, guests, shifts, incidents] = await Promise.all([
    db.select().from(bookingTable),
    db.select().from(bedTable),
    db.select().from(guestTable),
    db.select().from(shiftTable),
    db.select().from(incidentLogTable),
  ]);

  // Build lookup maps
  const bedById = new Map(beds.map((b) => [b.id, b]));
  const guestById = new Map(guests.map((g) => [g.id, g]));

  // ── Bucket: Arrivals due (from_date === D) ────────────────────────────────
  // Exclude no-shows/cancellations — those surface in their own bucket, not here.
  const arrivals = bookings.filter(
    (b) => b.from_date === D && b.status !== "no_show" && b.status !== "cancelled",
  );

  // ── Bucket: Departures due (to_date === D) ────────────────────────────────
  const departures = bookings.filter(
    (b) => b.to_date === D && b.status !== "no_show" && b.status !== "cancelled",
  );

  // ── Bucket: No-shows to handle (status=no_show AND from_date <= D) ────────
  const noShows = bookings.filter(
    (b) => b.status === "no_show" && b.from_date <= D,
  );

  // ── Bucket: In-house tonight ───────────────────────────────────────────────
  // from_date <= D AND to_date >= D AND status === "checked_in"
  const inHouseBookings = bookings.filter(
    (b) =>
      b.from_date <= D &&
      b.to_date >= D &&
      b.status === "checked_in",
  );
  const totalBeds = beds.filter((b) => !b.out_of_service).length;

  // ── Bucket: Shifts today ───────────────────────────────────────────────────
  const shiftsToday = shifts.filter(
    (s) => dateOf(s.starts_at) === D,
  );

  // ── Bucket: Open incidents (occurred_at date === D AND resolved=false) ────
  const openIncidents = incidents.filter(
    (i) => dateOf(i.occurred_at) === D && i.resolved === false,
  );

  // ── Bucket: Work-traders on site ─────────────────────────────────────────
  // Bookings where source=work_trade, from_date<=D<=to_date, status=checked_in
  const workTraderBookings = bookings.filter(
    (b) =>
      b.source === "work_trade" &&
      b.from_date <= D &&
      b.to_date >= D &&
      (b.status === "checked_in" || b.status === "confirmed"),
  );

  // ── Summary line ──────────────────────────────────────────────────────────
  const arrivalsCount = arrivals.length;
  const departuresCount = departures.length;
  const noShowsCount = noShows.length;
  const openShiftsCount = shiftsToday.filter(
    (s) => s.status === "open" || !s.claimed_by,
  ).length;
  const incidentsCount = openIncidents.length;

  const summaryParts = [
    `${arrivalsCount} arrival${arrivalsCount !== 1 ? "s" : ""}`,
    `${departuresCount} departure${departuresCount !== 1 ? "s" : ""}`,
    noShowsCount > 0
      ? `${noShowsCount} no-show${noShowsCount !== 1 ? "s" : ""}`
      : null,
    `${openShiftsCount} open shift${openShiftsCount !== 1 ? "s" : ""}`,
    incidentsCount > 0
      ? `${incidentsCount} incident${incidentsCount !== 1 ? "s" : ""}`
      : null,
  ].filter(Boolean);

  const summary = summaryParts.join(" · ");

  // ── Helpers for rendering ─────────────────────────────────────────────────

  function guestName(guestId: string): string {
    return guestById.get(guestId)?.full_name ?? `Guest ${guestId.slice(0, 8)}`;
  }

  function bedCode(bedId: string): string {
    return bedById.get(bedId)?.code ?? `Bed ${bedId.slice(0, 8)}`;
  }

  function fmtTime(ts: Date | string): string {
    const iso = typeof ts === "string" ? ts : ts.toISOString();
    // Format HH:MM from the timestamp
    return iso.slice(11, 16);
  }

  return (
    <main>
      <div className="mx-auto max-w-4xl px-8 py-10 space-y-8">

        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href={`/day?date=${prevDay}`}
              className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
            >
              ← {prevDay}
            </Link>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {D}
            </h1>
            <Link
              href={`/day?date=${nextDay}`}
              className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
            >
              {nextDay} →
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>

        {/* In-house occupancy — compact banner */}
        <div className="rounded-md border border-border bg-card/50 px-4 py-3 flex items-center gap-4">
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            In-house tonight
          </span>
          <span className="text-2xl font-bold text-foreground">
            {inHouseBookings.length}
          </span>
          <span className="text-sm text-muted-foreground">
            / {totalBeds} beds
          </span>
        </div>

        {/* Arrivals */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Arrivals due ({arrivalsCount})
          </h2>
          {arrivals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing today.</p>
          ) : (
            <ul className="space-y-2">
              {arrivals.map((b) => {
                const needsCheckIn = b.status === "confirmed";
                const isCheckedIn = b.status === "checked_in";
                return (
                  <li
                    key={b.id}
                    className="rounded-md border border-border bg-card/50 p-3 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm text-foreground">
                        {guestName(b.guest)}
                      </span>
                      <span className="mx-2 text-muted-foreground">·</span>
                      <span className="text-sm text-muted-foreground">
                        {bedCode(b.bed)}
                      </span>
                      <span className="mx-2 text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {b.label}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 text-xs rounded px-2 py-0.5 font-medium border ${
                        needsCheckIn
                          ? "bg-primary/10 text-primary border-primary/30"
                          : isCheckedIn
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      {needsCheckIn
                        ? "needs check-in"
                        : isCheckedIn
                        ? "checked in"
                        : b.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Departures */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Departures due ({departuresCount})
          </h2>
          {departures.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing today.</p>
          ) : (
            <ul className="space-y-2">
              {departures.map((b) => (
                <li
                  key={b.id}
                  className="rounded-md border border-border bg-card/50 p-3 flex items-center gap-3"
                >
                  <span className="font-medium text-sm text-foreground flex-1">
                    {guestName(b.guest)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {bedCode(b.bed)}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">
                    {b.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* No-shows */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            No-shows to handle ({noShowsCount})
          </h2>
          {noShows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing today.</p>
          ) : (
            <ul className="space-y-2">
              {noShows.map((b) => (
                <li
                  key={b.id}
                  className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex items-center gap-3"
                >
                  <span className="font-medium text-sm text-foreground flex-1">
                    {guestName(b.guest)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {bedCode(b.bed)}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">
                    {b.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    from {b.from_date}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Shifts today */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Shifts today ({shiftsToday.length})
          </h2>
          {shiftsToday.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing today.</p>
          ) : (
            <ul className="space-y-2">
              {shiftsToday.map((s) => {
                const isOpen = s.status === "open";
                return (
                  <li
                    key={s.id}
                    className={`rounded-md border p-3 flex items-center gap-3 ${
                      isOpen
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-border bg-card/50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm text-foreground">
                        {s.label}
                      </span>
                      <span className="mx-2 text-muted-foreground text-xs">
                        {s.kind}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {fmtTime(s.starts_at)} · {Number(s.duration_hours)}h
                      </span>
                    </div>
                    <span
                      className={`shrink-0 text-xs rounded px-2 py-0.5 font-medium border ${
                        isOpen
                          ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                          : "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      {isOpen ? "OPEN" : (s.claimed_by ? "assigned" : s.status)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Open incidents */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Open incidents today ({incidentsCount})
          </h2>
          {openIncidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing today.</p>
          ) : (
            <ul className="space-y-2">
              {openIncidents.map((i) => (
                <li
                  key={i.id}
                  className={`rounded-md border p-3 space-y-1 ${severityClass(i.severity)}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{i.summary}</span>
                    <span
                      className={`text-xs rounded px-1.5 py-0.5 border font-mono uppercase ${severityClass(i.severity)}`}
                    >
                      {i.severity}
                    </span>
                    <span className="text-xs opacity-70">{i.category}</span>
                  </div>
                  {i.body && (
                    <p className="text-xs opacity-80 leading-relaxed">
                      {i.body}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Work-traders on site */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Work-traders on site ({workTraderBookings.length})
          </h2>
          {workTraderBookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">None today.</p>
          ) : (
            <ul className="space-y-1">
              {workTraderBookings.map((b) => {
                const g = guestById.get(b.guest);
                return (
                  <li
                    key={b.id}
                    className="text-sm text-foreground flex items-center gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span>{g?.full_name ?? `Guest ${b.guest.slice(0, 8)}`}</span>
                    {g?.country && (
                      <span className="text-xs text-muted-foreground">
                        ({g.country})
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Footer */}
        <p className="text-xs text-muted-foreground pt-4 border-t border-border">
          Read-only view. Data reflects the live database.
        </p>
      </div>
    </main>
  );
}
