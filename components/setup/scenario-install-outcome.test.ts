// land_on_board — after a successful scenario install the steward should be
// taken straight to the home board ("/"), not shown a "reload the app" toast.
//
// ScenarioPicker is a client component (useTransition/useState/useRouter +
// fetch) and this package has no jsdom/RTL, so we extract the post-install
// decision into a pure function and unit-test it here. The component then acts
// on the decision: navigate -> router.push, toast -> setToast. The router.push
// wiring itself is asserted at the source level in ScenarioPicker.test.tsx.

import { describe, expect, it } from "vitest";
import { decideInstallOutcome } from "./scenario-install-outcome";

describe("decideInstallOutcome", () => {
  it("navigates to / on a successful install (no reload toast)", () => {
    const outcome = decideInstallOutcome(
      { ok: true, status: 200 },
      {},
      "small-community",
    );
    expect(outcome).toEqual({ kind: "navigate", to: "/" });
  });

  it("never produces a 'reload' toast on success", () => {
    const outcome = decideInstallOutcome({ ok: true, status: 200 }, {}, "x");
    expect(JSON.stringify(outcome).toLowerCase()).not.toContain("reload");
  });

  it("returns a locked toast on 409 (already set up)", () => {
    const outcome = decideInstallOutcome(
      { ok: false, status: 409 },
      {},
      "hostel",
    );
    expect(outcome.kind).toBe("toast");
    if (outcome.kind === "toast") {
      expect(outcome.toast.kind).toBe("error");
      expect(outcome.toast.message).toMatch(/locked|already set up/i);
    }
  });

  it("surfaces the server error message on other failures", () => {
    const outcome = decideInstallOutcome(
      { ok: false, status: 500 },
      { error: "codegen blew up" },
      "hostel",
    );
    expect(outcome).toEqual({
      kind: "toast",
      toast: { kind: "error", message: "codegen blew up" },
    });
  });

  it("falls back to a generic failure message when the body has no error", () => {
    const outcome = decideInstallOutcome(
      { ok: false, status: 502 },
      {},
      "hostel",
    );
    expect(outcome.kind).toBe("toast");
    if (outcome.kind === "toast") {
      expect(outcome.toast.message).toMatch(/502/);
    }
  });
});
