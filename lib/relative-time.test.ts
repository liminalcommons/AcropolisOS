import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatRelative } from "./relative-time";

describe("formatRelative", () => {
  const NOW = new Date("2026-05-18T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for deltas under 5 seconds", () => {
    const iso = new Date(NOW.getTime() - 2 * 1000).toISOString();
    expect(formatRelative(iso)).toBe("just now");
  });

  it("returns seconds for deltas under a minute", () => {
    const iso = new Date(NOW.getTime() - 30 * 1000).toISOString();
    expect(formatRelative(iso)).toBe("30s ago");
  });

  it("returns minutes for deltas under an hour", () => {
    const iso = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
    expect(formatRelative(iso)).toBe("5m ago");
  });

  it("returns hours for deltas under a day", () => {
    const iso = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelative(iso)).toBe("2h ago");
  });

  it("returns 'yesterday' for exactly 1 day ago", () => {
    const iso = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelative(iso)).toBe("yesterday");
  });

  it("returns days for deltas under a week", () => {
    const iso = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelative(iso)).toBe("3d ago");
  });

  it("returns an absolute short date for ≥ 7 days ago", () => {
    // 2026-03-14, well over a week before NOW (2026-05-18).
    const iso = new Date("2026-03-14T09:00:00.000Z").toISOString();
    expect(formatRelative(iso)).toBe("Mar 14");
  });

  it("returns the input verbatim when ISO is unparseable", () => {
    expect(formatRelative("not-a-date")).toBe("not-a-date");
  });
});
