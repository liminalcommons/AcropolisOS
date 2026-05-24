import { describe, it, expect, vi, afterEach } from "vitest";
import {
  TODAY,
  TODAY_LABEL,
  formatTodayLabel,
  serverNow,
  isToday,
  isYesterday,
  isTomorrow,
  daysFromToday,
} from "./today";

afterEach(() => {
  vi.useRealTimers();
});

describe("today anchor", () => {
  it("TODAY is 2026-06-05 UTC", () => {
    expect(TODAY.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });

  it("TODAY_LABEL shape matches weekday-comma-month-day pattern", () => {
    // e.g. "Fri, Jun 5" — test shape, not literal, so the test survives a
    // TODAY change without becoming a tautology
    expect(TODAY_LABEL).toMatch(/^\w{3}, \w{3} \d+$/);
  });

  it("TODAY_LABEL is derived from TODAY (coherence check)", () => {
    expect(TODAY_LABEL).toBe(formatTodayLabel(TODAY));
  });

  it("formatTodayLabel produces correct label for 2026-06-05 (Friday)", () => {
    expect(formatTodayLabel(new Date("2026-06-05T00:00:00Z"))).toBe("Fri, Jun 5");
  });

  it("formatTodayLabel produces correct label for 2026-07-12 (Sunday)", () => {
    expect(formatTodayLabel(new Date("2026-07-12T00:00:00Z"))).toBe("Sun, Jul 12");
  });
});

describe("serverNow", () => {
  it("returns TODAY in demo mode", () => {
    expect(serverNow().getTime()).toBe(TODAY.getTime());
  });
});

describe("isToday", () => {
  it("returns true for an ISO string on the anchor date (mid-day UTC)", () => {
    expect(isToday("2026-06-05T22:05:00Z")).toBe(true);
  });

  it("returns true for the anchor date midnight UTC", () => {
    expect(isToday("2026-06-05T00:00:00Z")).toBe(true);
  });

  it("returns false for yesterday", () => {
    expect(isToday("2026-06-04T23:59:59Z")).toBe(false);
  });

  it("returns false for tomorrow", () => {
    expect(isToday("2026-06-06T00:00:00Z")).toBe(false);
  });

  it("accepts a Date object", () => {
    expect(isToday(new Date("2026-06-05T14:30:00Z"))).toBe(true);
  });

  // --- cycle-4 missing tests ---

  it("TODAY constant round-trip: isToday(TODAY) === true", () => {
    expect(isToday(TODAY)).toBe(true);
  });

  it("Date.now() smoke via fake timers: isToday(new Date()) === true at 2026-06-05T12:00:00Z", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T12:00:00Z"));
    expect(isToday(new Date())).toBe(true);
  });

  it("date-only ISO string 2026-06-05 is accepted as today", () => {
    expect(isToday("2026-06-05")).toBe(true);
  });

  it("leap day 2024-02-29 is not today", () => {
    expect(isToday("2024-02-29")).toBe(false);
  });

  it("midnight boundary: 2026-06-05T23:59:59Z is still today", () => {
    expect(isToday("2026-06-05T23:59:59Z")).toBe(true);
  });

  it("midnight boundary: 2026-06-06T00:00:00Z is not today", () => {
    expect(isToday("2026-06-06T00:00:00Z")).toBe(false);
  });

  // --- invalid input (throw on Invalid Date) ---

  it("throws TypeError on invalid date string", () => {
    expect(() => isToday("garbage")).toThrow(/invalid date/i);
  });

  it("throws TypeError on empty string", () => {
    expect(() => isToday("")).toThrow(/invalid date/i);
  });

  // --- TZ-ambiguous rejection ---

  it("throws TypeError on ISO datetime without TZ offset", () => {
    expect(() => isToday("2026-06-05T22:05:00")).toThrow(/ambiguous/i);
  });

  it("accepts ISO datetime with Z suffix", () => {
    expect(() => isToday("2026-06-05T22:05:00Z")).not.toThrow();
  });

  it("accepts ISO datetime with negative offset", () => {
    expect(() => isToday("2026-06-05T22:05:00-04:00")).not.toThrow();
  });
});

describe("isYesterday", () => {
  it("returns true for 2026-06-04 UTC", () => {
    expect(isYesterday("2026-06-04T10:00:00Z")).toBe(true);
  });

  it("returns false for today", () => {
    expect(isYesterday("2026-06-05T10:00:00Z")).toBe(false);
  });

  // --- cycle-4 missing tests ---

  it("week-boundary inverse: isYesterday('2026-06-04') === true", () => {
    expect(isYesterday("2026-06-04")).toBe(true);
  });

  // --- invalid input ---

  it("throws TypeError on invalid date input", () => {
    expect(() => isYesterday("garbage")).toThrow(/invalid date/i);
  });

  // --- TZ-ambiguous rejection ---

  it("throws TypeError on ISO datetime without TZ offset", () => {
    expect(() => isYesterday("2026-06-04T10:00:00")).toThrow(/ambiguous/i);
  });
});

describe("isTomorrow", () => {
  it("returns true for 2026-06-06 UTC", () => {
    expect(isTomorrow("2026-06-06T08:00:00Z")).toBe(true);
  });

  it("returns false for today", () => {
    expect(isTomorrow("2026-06-05T08:00:00Z")).toBe(false);
  });

  // --- cycle-4 missing tests ---

  it("week-boundary inverse: isTomorrow('2026-06-06') === true", () => {
    expect(isTomorrow("2026-06-06")).toBe(true);
  });

  // --- invalid input ---

  it("throws TypeError on invalid date input", () => {
    expect(() => isTomorrow("garbage")).toThrow(/invalid date/i);
  });

  // --- TZ-ambiguous rejection ---

  it("throws TypeError on ISO datetime without TZ offset", () => {
    expect(() => isTomorrow("2026-06-06T08:00:00")).toThrow(/ambiguous/i);
  });
});

describe("daysFromToday", () => {
  it("returns 0 for today", () => {
    expect(daysFromToday("2026-06-05T00:00:00Z")).toBe(0);
  });

  it("returns -1 for yesterday", () => {
    expect(daysFromToday("2026-06-04T10:00:00Z")).toBe(-1);
  });

  it("returns 1 for tomorrow", () => {
    expect(daysFromToday("2026-06-06T23:59:59Z")).toBe(1);
  });

  it("returns 5 for five days ahead", () => {
    expect(daysFromToday("2026-06-10")).toBe(5);
  });

  it("returns -26 for 26 days before TODAY (wta-001 start check)", () => {
    expect(daysFromToday("2026-05-10")).toBe(-26);
  });

  it("returns 26 for 2026-07-01 (wta-001 end date from TODAY=Jun 5)", () => {
    expect(daysFromToday("2026-07-01")).toBe(26);
  });

  // --- cycle-4 missing tests ---

  it("TODAY constant round-trip: daysFromToday(TODAY) === 0", () => {
    expect(daysFromToday(TODAY)).toBe(0);
  });

  it("leap day 2024-02-29 is -827 days from TODAY", () => {
    expect(daysFromToday("2024-02-29")).toBe(-827);
  });

  it("12-hour drift edge: 2026-06-04T12:00:00Z snaps to day bucket -1", () => {
    expect(daysFromToday("2026-06-04T12:00:00Z")).toBe(-1);
  });

  // --- invalid input ---

  it("throws TypeError on invalid date input", () => {
    expect(() => daysFromToday("garbage")).toThrow(/invalid date/i);
  });

  // --- TZ-ambiguous rejection ---

  it("throws TypeError on ISO datetime without TZ offset", () => {
    expect(() => daysFromToday("2026-06-05T22:05:00")).toThrow(/ambiguous/i);
  });
});
