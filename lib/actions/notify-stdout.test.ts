// M2.4 step-2: structured-JSON stdout adapter.
//
// The default notify_member sink writes ONE line of JSON to stdout so any
// process collector (Docker logs, journald, Vercel functions logger) can
// pick it up as a structured event without parsing a sentence. The legacy
// `makeLogMailer` printed a free-form sentence; M2.4 replaces it.
//
// Contract (frozen by this test):
//   - One console.log call per send.
//   - The line is valid JSON.
//   - Shape: { event: "notify_member", recipient, subject, body, at }
//   - `at` is an ISO-8601 string the test treats opaquely.

import { afterEach, describe, expect, it, vi } from "vitest";
import { makeStdoutMailer } from "./notify-stdout";

describe("makeStdoutMailer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one structured JSON line per send and resolves successfully", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const mailer = makeStdoutMailer();
    await mailer({
      to: "alice@example.com",
      subject: "Your tier changed",
      body: "Welcome to sustaining tier",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      event: "notify_member",
      recipient: "alice@example.com",
      subject: "Your tier changed",
      body: "Welcome to sustaining tier",
    });
    expect(typeof parsed.at).toBe("string");
    expect(() => new Date(parsed.at as string)).not.toThrow();
  });

  it("handles empty body without throwing", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const mailer = makeStdoutMailer();
    await expect(
      mailer({ to: "bob@example.com", subject: "hi", body: "" }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
