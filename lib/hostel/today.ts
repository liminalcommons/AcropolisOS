// Single source of truth for the demo anchor date.
//
// TODAY is anchored to 2026-06-05 (Thursday, Jun 5) — the date Daniyar's
// no_show booking (bk-010) starts and incident_log entry in-004 fires at
// 22:05. All F5 attention-card date arithmetic and bed-grid headers must
// derive from this constant; never hardcode "Jun 4" or "Jun 5" in JSX.
//
// All comparisons use UTC day boundaries so the container TZ cannot shift
// the result. Input can be an ISO string or a Date object.

/** Anchor date for the demo: 2026-06-05T00:00:00Z */
export const TODAY = new Date("2026-06-05T00:00:00Z");

/** ISO date string for the demo anchor: "2026-06-05" */
export const TODAY_ISO = "2026-06-05";

/** Short label for UI headers, e.g. "Tonight's beds — Thu Jun 5" */
export const TODAY_LABEL = "Thu Jun 5";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the UTC midnight (start-of-day) for any Date or ISO string. */
function utcDayStart(d: Date | string): Date {
  const dt = typeof d === "string" ? new Date(d) : d;
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
