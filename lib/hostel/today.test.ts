import { describe, it, expect } from "vitest";
import {
  TODAY,
  TODAY_ISO,
  TODAY_LABEL,
  isToday,
  isYesterday,
  isTomorrow,
  daysFromToday,
} from "./today";

describe("today anchor", () => {
  it("TODAY is 2026-06-05 UTC", () => {
    expect(TODAY.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });

  it("TODAY_ISO is the correct string", () => {
    expect(TODAY_ISO).toBe("2026-06-05");
  });

  it("TODAY_LABEL is the correct header string", () => {
    expect(TODAY_LABEL).toBe("Thu Jun 5");
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
});

describe("isYesterday", () => {
  it("returns true for 2026-06-04 UTC", () => {
    expect(isYesterday("2026-06-04T10:00:00Z")).toBe(true);
  });

  it("returns false for today", () => {
    expect(isYesterday("2026-06-05T10:00:00Z")).toBe(false);
  });
});

describe("isTomorrow", () => {
  it("returns true for 2026-06-06 UTC", () => {
    expect(isTomorrow("2026-06-06T08:00:00Z")).toBe(true);
  });

  it("returns false for today", () => {
    expect(isTomorrow("2026-06-05T08:00:00Z")).toBe(false);
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
});
