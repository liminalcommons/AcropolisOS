// Single source of truth for the demo anchor date.
//
// TODAY is anchored to 2026-06-05 (Friday, Jun 5) — the date Daniyar's
// no_show booking (bk-010) starts and incident_log entry in-004 fires at
// 22:05. All F5 attention-card date arithmetic and bed-grid headers must
// derive from this constant; never hardcode "Jun 4" or "Jun 5" in JSX.
//
// All comparisons use UTC day boundaries so the container TZ cannot shift
// the result. Input can be an ISO string or a Date object.
//
// Namespace: lib/me/ (not lib/hostel/) because TODAY is a dashboard/agent-read
// concern, not a seed-shape concern. lib/hostel/ holds pure seed-shape helpers
// (bed-code, bed-grid-filter). See cycle-4 audit rationale.

/**
 * @deprecated-for-prod — TODAY is a demo anchor. In production, replace with
 * serverNow(). Import serverNow() in callers so the prod migration is a
 * one-line change here rather than a find-every-import rewrite.
 */
export const TODAY = new Date("2026-06-05T00:00:00Z");

// ---------------------------------------------------------------------------
// Prod-migration placeholder
// ---------------------------------------------------------------------------

/**
 * Real-time clock for prod. Demo currently returns TODAY; one-line change
 * to flip: `return new Date();`
 */
export function serverNow(): Date {
  return TODAY;
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

/**
 * Formats a Date to a short human label using UTC timezone.
 * Example output on Node 24: "Fri, Jun 5"
 * Pin timeZone: "UTC" so container TZ cannot shift the label.
 */
export function formatTodayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Short label for UI headers, e.g. "Tonight's beds — Fri, Jun 5" */
export const TODAY_LABEL = formatTodayLabel(TODAY);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the UTC midnight (start-of-day) for any Date or ISO string. */
function utcDayStart(input: Date | string): Date {
  if (typeof input === "string" && input.includes("T")) {
    // Reject ISO datetime strings without a timezone designator.
    // Date-only strings ("2026-06-05") are unambiguous (UTC midnight).
    // Datetime strings without Z or ±HH:MM are parsed as local time,
    // breaking the UTC-boundary invariant near midnight.
    if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(input)) {
      throw new TypeError(
        `today.ts: ISO datetime without timezone offset is ambiguous: ${input}`
      );
    }
  }

  const dt = typeof input === "string" ? new Date(input) : input;

  if (Number.isNaN(dt.getTime())) {
    throw new TypeError(`today.ts: invalid date input: ${String(input)}`);
  }

  return new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
  );
}

const TODAY_START = utcDayStart(TODAY);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns true if `date` falls on the same UTC calendar day as TODAY
 * (2026-06-05).
 */
export function isToday(date: Date | string): boolean {
  return utcDayStart(date).getTime() === TODAY_START.getTime();
}

/**
 * Returns true if `date` falls on the UTC calendar day immediately before
 * TODAY (2026-06-04).
 */
export function isYesterday(date: Date | string): boolean {
  return (
    utcDayStart(date).getTime() === TODAY_START.getTime() - MS_PER_DAY
  );
}

/**
 * Returns true if `date` falls on the UTC calendar day immediately after
 * TODAY (2026-06-06).
 */
export function isTomorrow(date: Date | string): boolean {
  return (
    utcDayStart(date).getTime() === TODAY_START.getTime() + MS_PER_DAY
  );
}

/**
 * Returns the signed whole-day offset from TODAY.
 *
 * - Negative  → `date` is in the past  (e.g. -1 = yesterday)
 * - Zero      → `date` is today
 * - Positive  → `date` is in the future (e.g. +5 = five days from now)
 */
export function daysFromToday(date: Date | string): number {
  const delta = utcDayStart(date).getTime() - TODAY_START.getTime();
  return Math.round(delta / MS_PER_DAY);
}
