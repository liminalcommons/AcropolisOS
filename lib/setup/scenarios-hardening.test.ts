// scenario_hardening — a single malformed scenario.json must not break /setup.
//
// discoverScenarios() runs on first-run setup. Before this hardening, a bundle
// whose scenario.json is invalid JSON (or violates the manifest schema) made
// JSON.parse / parseScenarioManifest throw and propagate out of the loop, so the
// WHOLE discovery threw and the wizard could not list any scenario. The fix
// wraps each bundle's manifest parse in try/catch and skips the bad one.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverScenarios } from "./scenarios";

let root: string;

async function makeBundle(name: string, manifest: string | null) {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  if (manifest !== null) {
    await writeFile(path.join(dir, "scenario.json"), manifest, "utf8");
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "acrop-scenarios-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("discoverScenarios — malformed bundle tolerance", () => {
  it("skips a malformed-JSON bundle and a manifest-less dir, keeps the valid one", async () => {
    await makeBundle(
      "good",
      JSON.stringify({
        name: "good",
        description: "valid bundle",
        default: true,
        version: "1.0.0",
      }),
    );
    await makeBundle("broken-json", "{ this is not json ");
    await makeBundle("no-manifest", null);

    const found = await discoverScenarios(root);
    expect(found.map((s) => s.manifest.name)).toEqual(["good"]);
  });

  it("skips a bundle whose manifest violates the schema (missing version)", async () => {
    await makeBundle(
      "good",
      JSON.stringify({
        name: "good",
        description: "valid",
        default: false,
        version: "1.0.0",
      }),
    );
    await makeBundle(
      "schema-bad",
      JSON.stringify({ name: "schema-bad", description: "no version" }),
    );

    const found = await discoverScenarios(root);
    expect(found.map((s) => s.manifest.name)).toEqual(["good"]);
  });

  it("does not throw when EVERY bundle is malformed (returns empty)", async () => {
    await makeBundle("a", "not json");
    await makeBundle("b", JSON.stringify({ nope: true }));
    await expect(discoverScenarios(root)).resolves.toEqual([]);
  });
});
