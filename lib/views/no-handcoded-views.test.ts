import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// S4-T20: the substrate generates views from the ontology + approved-view
// registry. No hand-coded, domain-literal page may ship. app/day/page.tsx was
// the hostel "Today" view (raw bed/booking/shift SQL) — it must be gone, and
// nothing may link to /day.
const PKG = path.resolve(__dirname, "..", "..");

describe("no hand-coded domain views", () => {
  it("app/day/page.tsx is deleted", () => {
    expect(existsSync(path.join(PKG, "app", "day", "page.tsx"))).toBe(false);
  });

  it("the shell nav no longer links to /day", () => {
    const nav = readFileSync(
      path.join(PKG, "components", "shell", "top-bar.tsx"),
      "utf8",
    );
    expect(nav).not.toMatch(/["'`]\/day["'`]/);
  });
});
