import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCustomRoleNames } from "./roles";

const PKG_ROOT = path.resolve(__dirname, "..", "..");

describe("loadCustomRoleNames", () => {
  it("returns custom role names from the small-community seed (none beyond built-ins)", async () => {
    const names = await loadCustomRoleNames(
      path.join(PKG_ROOT, "scenarios", "small-community", "ontology"),
    );
    expect(names).toEqual([]);
  });

  it("returns [] when the ontology directory has no roles.yaml", async () => {
    const names = await loadCustomRoleNames(
      path.join(PKG_ROOT, "scenarios", "small-community", "ontology", "action-types"),
    );
    expect(names).toEqual([]);
  });
});
