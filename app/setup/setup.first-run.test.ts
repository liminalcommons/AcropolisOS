import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

// redirect_deadlock — first-run reachability invariant.
//
// On a first install the user is anonymous AND setup is incomplete. The
// middleware (lib/middleware/route-decision.ts) sends that user to /setup.
// If SetupPage itself then bounces anonymous callers to /signin, the middleware
// turns around and sends /signin (anonymous + !setupComplete) back to /setup —
// an infinite redirect loop that makes the wizard unreachable.
//
// The middleware is the auth gate. SetupPage must therefore NOT contain its own
// anonymous -> /signin redirect. We assert against the page SOURCE because the
// page is a server component that pulls in the DB client, the chat runtime, and
// the user store — rendering it in a node test would require mocking the whole
// server stack, which would not actually exercise the deadlock.
const PAGE = path.resolve(__dirname, "page.tsx");

describe("first-run /setup reachability (redirect_deadlock)", () => {
  it("does not redirect anonymous callers to /signin (would deadlock with middleware)", async () => {
    const src = await readFile(PAGE, "utf8");
    expect(src).not.toMatch(/redirect\(\s*["']\/signin["']\s*\)/);
    // and the isAnonymous-gated bounce must be gone entirely
    expect(src).not.toMatch(/isAnonymous\([^)]*\)\s*\)\s*\{[\s\S]*?redirect/);
  });

  it("still renders all five wizard step cards", async () => {
    const src = await readFile(PAGE, "utf8");
    for (const step of [1, 2, 3, 4, 5]) {
      expect(src).toMatch(new RegExp(`step=\\{${step}\\}`));
    }
  });
});
