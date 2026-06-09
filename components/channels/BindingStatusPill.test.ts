// components/channels/BindingStatusPill.test.ts
//
// TDD lock on the PURE status→presentation mapping behind <BindingStatusPill>.
// The pill is the honest liveness chip the /channels surface paints; its class
// strings must use GOVERNED THEME TOKENS ONLY (success / warning / destructive /
// muted-foreground / card / border / foreground) — never a palette literal — and
// each status must carry the stable human label fixed by the approved mockup
// (.chora/artifacts/2026-06-02-acropolisos-channels-ui-mockup.html) legend.
//
// The component render itself is held by tsc + the page composition; this test
// locks the deterministic, render-free core (status → token class + label) the
// same way lib/channels/view.test.ts does — no DOM env needed.

import { describe, expect, it } from "vitest";
import type { BindingStatus } from "@/lib/channels/status";
import { bindingStatusPill } from "@/components/channels/BindingStatusPill";

const ALL: BindingStatus[] = ["offline", "unbound", "awaiting", "receiving", "idle"];

// No palette literal (text-emerald-*, bg-amber-*, text-rose-*, …) may appear in
// any class the pill emits — the same discipline gate as the T11 sweep.
const PALETTE =
  /\b(?:text|bg|border|ring|fill|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/;

describe("bindingStatusPill", () => {
  it("returns a non-empty human label for every status", () => {
    for (const s of ALL) {
      expect(bindingStatusPill(s).label.length).toBeGreaterThan(0);
    }
  });

  it("maps each status to the stable mockup-legend label", () => {
    expect(bindingStatusPill("receiving").label).toBe("receiving");
    expect(bindingStatusPill("idle").label).toBe("idle");
    expect(bindingStatusPill("awaiting").label).toBe("awaiting first message");
    expect(bindingStatusPill("unbound").label).toBe("discovered · unbound");
    expect(bindingStatusPill("offline").label).toBe("offline");
  });

  it("paints receiving→success, idle→warning, offline→destructive", () => {
    expect(bindingStatusPill("receiving").pillClass).toContain("success");
    expect(bindingStatusPill("receiving").dotClass).toContain("success");
    expect(bindingStatusPill("idle").pillClass).toContain("warning");
    expect(bindingStatusPill("idle").dotClass).toContain("warning");
    const off = bindingStatusPill("offline");
    expect(`${off.dotClass} ${off.pillClass}`).toContain("destructive");
  });

  it("paints awaiting + unbound with muted tokens — never a green/red light", () => {
    for (const s of ["awaiting", "unbound"] as BindingStatus[]) {
      const p = bindingStatusPill(s);
      const blob = `${p.dotClass} ${p.pillClass}`;
      expect(blob).toContain("muted-foreground");
      expect(blob).not.toContain("success");
      expect(blob).not.toContain("destructive");
    }
  });

  it("carries the rounded-full chip wrapper layout for every status", () => {
    for (const s of ALL) {
      expect(bindingStatusPill(s).wrapperClass).toContain("rounded-full");
    }
  });

  it("uses ONLY governed theme tokens — never a palette literal", () => {
    for (const s of ALL) {
      const p = bindingStatusPill(s);
      const blob = `${p.dotClass} ${p.pillClass} ${p.wrapperClass}`;
      expect(blob).not.toMatch(PALETTE);
    }
  });
});
