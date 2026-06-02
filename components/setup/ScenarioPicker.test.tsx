// land_on_board (wiring) — ScenarioPicker must route to "/" on a successful
// install via next/navigation's useRouter, not show a "reload" toast.
//
// This package has no jsdom/RTL and useRouter requires the Next App-Router
// provider, so a full render-and-click test is not possible here. The pure
// decision is covered in scenario-install-outcome.test.ts; this test guards the
// component WIRING at the source level: it imports useRouter and forwards the
// "navigate" outcome to router.push.

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SRC = path.resolve(__dirname, "ScenarioPicker.tsx");

describe("ScenarioPicker — lands on the board (wiring)", () => {
  it("imports useRouter from next/navigation", async () => {
    const src = await readFile(SRC, "utf8");
    expect(src).toMatch(/import\s*\{[^}]*useRouter[^}]*\}\s*from\s*["']next\/navigation["']/);
  });

  it("pushes the navigate target onto the router (no reload toast)", async () => {
    const src = await readFile(SRC, "utf8");
    expect(src).toMatch(/router\.push\(outcome\.to\)/);
    // the dead "reload the app" message must be gone
    expect(src.toLowerCase()).not.toContain("reload the app");
  });

  it("derives the outcome from the shared pure helper", async () => {
    const src = await readFile(SRC, "utf8");
    expect(src).toMatch(/decideInstallOutcome\(/);
  });
});
