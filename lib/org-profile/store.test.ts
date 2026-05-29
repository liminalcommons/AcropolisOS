import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import {
  ORG_NAME_FALLBACK,
  ORG_NAME_MAX,
  mergeProfile,
  resolveOrgDisplayName,
  validateOrgName,
} from "./shared";
import { readOrgProfile, writeOrgProfile } from "./store";

// Fixture file lives INSIDE the package tree (vitest/Vite intercepts dynamic
// imports outside the project root — fs is fine, but keep test artifacts local).
const TMP = path.join(__dirname, "__test-tmp__", "org-profile.json");

afterEach(async () => {
  await fs.rm(path.dirname(TMP), { recursive: true, force: true });
});

describe("resolveOrgDisplayName", () => {
  it("falls back to the product brand when profile is absent", () => {
    expect(resolveOrgDisplayName(null)).toBe(ORG_NAME_FALLBACK);
    expect(resolveOrgDisplayName(undefined)).toBe(ORG_NAME_FALLBACK);
  });

  it("falls back when name is empty or whitespace", () => {
    expect(resolveOrgDisplayName({ name: "" })).toBe(ORG_NAME_FALLBACK);
    expect(resolveOrgDisplayName({ name: "   " })).toBe(ORG_NAME_FALLBACK);
    expect(resolveOrgDisplayName({ description: "no name here" })).toBe(ORG_NAME_FALLBACK);
  });

  it("returns the trimmed name when present", () => {
    expect(resolveOrgDisplayName({ name: "  Sunseed Desert  " })).toBe("Sunseed Desert");
  });
});

describe("validateOrgName", () => {
  it("rejects empty / whitespace-only", () => {
    expect(validateOrgName("")).toMatchObject({ ok: false });
    expect(validateOrgName("   ")).toMatchObject({ ok: false });
  });

  it("rejects non-strings", () => {
    expect(validateOrgName(null)).toMatchObject({ ok: false });
    expect(validateOrgName(42)).toMatchObject({ ok: false });
  });

  it("rejects names longer than the max", () => {
    expect(validateOrgName("x".repeat(ORG_NAME_MAX + 1))).toMatchObject({ ok: false });
  });

  it("accepts and trims a valid name", () => {
    expect(validateOrgName("  Casa Verde  ")).toEqual({ ok: true, value: "Casa Verde" });
    expect(validateOrgName("x".repeat(ORG_NAME_MAX))).toMatchObject({ ok: true });
  });
});

describe("mergeProfile", () => {
  it("preserves description when patching only the name", () => {
    const merged = mergeProfile({ description: "a hostel" }, { name: "Casa Verde" });
    expect(merged).toMatchObject({ name: "Casa Verde", description: "a hostel" });
  });

  it("preserves name when patching only the description", () => {
    const merged = mergeProfile({ name: "Casa Verde" }, { description: "a hostel" });
    expect(merged).toMatchObject({ name: "Casa Verde", description: "a hostel" });
  });

  it("treats a null existing profile as empty", () => {
    expect(mergeProfile(null, { name: "Casa Verde" })).toMatchObject({ name: "Casa Verde" });
  });
});

describe("readOrgProfile / writeOrgProfile", () => {
  it("returns null when the file is absent", async () => {
    expect(await readOrgProfile(TMP)).toBeNull();
  });

  it("round-trips the name and stamps metadata", async () => {
    const written = await writeOrgProfile({ name: "Casa Verde" }, { updated_by: "steward@x" }, TMP);
    expect(written.name).toBe("Casa Verde");
    expect(written.updated_by).toBe("steward@x");
    expect(written.updated_at).toBeTruthy();

    const read = await readOrgProfile(TMP);
    expect(read?.name).toBe("Casa Verde");
  });

  it("merges across writes — naming does not wipe an existing description", async () => {
    await writeOrgProfile({ description: "a 60-bed hostel" }, { updated_by: "a" }, TMP);
    await writeOrgProfile({ name: "Casa Verde" }, { updated_by: "b" }, TMP);
    const read = await readOrgProfile(TMP);
    expect(read).toMatchObject({ name: "Casa Verde", description: "a 60-bed hostel" });
  });

  it("returns null on corrupt JSON instead of throwing", async () => {
    await fs.mkdir(path.dirname(TMP), { recursive: true });
    await fs.writeFile(TMP, "{ not json", "utf8");
    expect(await readOrgProfile(TMP)).toBeNull();
  });
});
